// 📊 Estadísticas del servidor (#538): una serie diaria (hora de Madrid) por métrica y su resumen (total, media, mejor día y
// variación respecto al periodo anterior del mismo tamaño). Métricas: mensajes y XP (contadas en `estadisticas_diarias`),
// economía neta y dinero apostado (del historial, que es de todo el bot) y horas de Plex (reproducciones del servidor). Las
// consultas agrupan por hora en SQL y se reparten por día en JS, así un rango de 90 días no trae cada fila. Sin Discord.
const db = require("../core/db");
const { momentoMadrid, sumarDias, fechaMadridAMs } = require("../core/zonaMadrid");

const RANGOS = [7, 30, 90];
const HORA_MS = 60 * 60 * 1000;
const METRICAS = {
    mensajes: { nombre: "Mensajes", emoji: "💬", unidad: "mensajes" },
    xp: { nombre: "XP", emoji: "⭐", unidad: "XP" },
    economia: { nombre: "Economía neta", emoji: "💰", unidad: "monedas", global: true },
    apuestas: { nombre: "Apuestas", emoji: "⚽", unidad: "monedas apostadas", global: true },
    plex: { nombre: "Horas de Plex", emoji: "🎬", unidad: "horas" },
};

/** Suma uno (o `n`) a la métrica del día de hoy en Madrid. Para mensajes y XP. */
function contar(guildId, metrica, n = 1, ahora = Date.now()) {
    if (!guildId || !n) return;
    db.prepare(
        `INSERT INTO estadisticas_diarias (guildId, dia, metrica, valor) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, metrica, dia) DO UPDATE SET valor = valor + excluded.valor`,
    ).run(String(guildId), momentoMadrid(ahora).dia, metrica, Math.round(n));
}

/** Los días «AAAA-MM-DD» del periodo: los `dias` que acaban hoy (o `finDia`), del más antiguo al más reciente. */
function diasDelPeriodo(dias, finDia) {
    return Array.from({ length: dias }, (_, i) => sumarDias(finDia, i - dias + 1));
}

const inicioDia = (dia) => fechaMadridAMs(`${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`);

/** Reparte en días de Madrid lo agrupado por hora ({ hora: ms del inicio de la hora, valor }). */
function porDia(filas) {
    const mapa = new Map();
    for (const f of filas) {
        const dia = momentoMadrid(f.hora).dia;
        mapa.set(dia, (mapa.get(dia) || 0) + Number(f.valor || 0));
    }
    return mapa;
}

function valoresContados(guildId, metrica, primero, ultimo) {
    return new Map(
        db
            .prepare("SELECT dia, valor FROM estadisticas_diarias WHERE guildId = ? AND metrica = ? AND dia BETWEEN ? AND ?")
            .all(String(guildId), metrica, primero, ultimo)
            .map((r) => [r.dia, r.valor]),
    );
}

function valoresHistorial(metrica, desde, hasta) {
    // Economía neta: todo lo que entra o sale del efectivo, sin los movimientos con el banco (cambian de bolsillo, no crean
    // ni destruyen dinero). Apuestas: lo apostado (los movimientos negativos de tipo apuestas).
    const sql =
        metrica === "economia"
            ? "SELECT substr(fecha, 1, 13) AS h, SUM(cantidad) AS valor FROM historial WHERE fecha >= ? AND fecha < ? AND COALESCE(tipo, '') != 'banco' GROUP BY h"
            : "SELECT substr(fecha, 1, 13) AS h, -SUM(cantidad) AS valor FROM historial WHERE fecha >= ? AND fecha < ? AND tipo = 'apuestas' AND cantidad < 0 GROUP BY h";
    const filas = db.prepare(sql).all(new Date(desde).toISOString(), new Date(hasta).toISOString());
    return porDia(filas.map((f) => ({ hora: Date.parse(`${f.h}:00:00.000Z`), valor: f.valor })));
}

function valoresPlex(guildId, desde, hasta) {
    const filas = db
        .prepare(
            `SELECT (inicio / 3600) AS h, SUM(segundos) AS valor FROM plex_reproducciones
             WHERE guildId = ? AND inicio >= ? AND inicio < ? GROUP BY h`,
        )
        .all(String(guildId), Math.floor(desde / 1000), Math.floor(hasta / 1000));
    const mapa = porDia(filas.map((f) => ({ hora: f.h * HORA_MS, valor: f.valor })));
    for (const [dia, segundos] of mapa) mapa.set(dia, Math.round((segundos / 3600) * 10) / 10);
    return mapa;
}

/**
 * La serie diaria de una métrica: [{ dia, valor }] de los `dias` que acaban en `finDia` (hoy por defecto), con 0 los días
 * sin datos.
 */
function serie(guildId, metrica, dias, { ahora = Date.now(), finDia = momentoMadrid(ahora).dia } = {}) {
    if (!METRICAS[metrica]) throw new Error(`Métrica desconocida: ${metrica}`);
    const lista = diasDelPeriodo(dias, finDia);
    const desde = inicioDia(lista[0]);
    const hasta = inicioDia(sumarDias(finDia, 1));
    const mapa =
        metrica === "mensajes" || metrica === "xp"
            ? valoresContados(guildId, metrica, lista[0], finDia)
            : metrica === "plex"
              ? valoresPlex(guildId, desde, hasta)
              : valoresHistorial(metrica, desde, hasta);
    return lista.map((dia) => ({ dia, valor: mapa.get(dia) || 0 }));
}

/**
 * Total, media diaria, mejor día y variación (%) respecto a `anterior` (el periodo de antes, mismo tamaño). La variación es
 * null si antes no había nada (no se puede dividir entre 0).
 */
function resumen(actual, anterior) {
    const suma = (s) => Math.round(s.reduce((t, d) => t + d.valor, 0) * 10) / 10;
    const total = suma(actual);
    const totalAntes = suma(anterior);
    const mejor = actual.reduce((m, d) => (d.valor > m.valor ? d : m), actual[0] || { dia: null, valor: 0 });
    return {
        total,
        media: actual.length ? Math.round((total / actual.length) * 10) / 10 : 0,
        mejor: mejor.valor > 0 ? mejor : null,
        totalAntes,
        variacion: totalAntes ? Math.round(((total - totalAntes) / Math.abs(totalAntes)) * 1000) / 10 : null,
    };
}

/** La serie del periodo y la del anterior, con su resumen. */
function periodo(guildId, metrica, dias, ahora = Date.now()) {
    const hoy = momentoMadrid(ahora).dia;
    const actual = serie(guildId, metrica, dias, { finDia: hoy });
    const anterior = serie(guildId, metrica, dias, { finDia: sumarDias(hoy, -dias) });
    return { metrica, dias, serie: actual, resumen: resumen(actual, anterior) };
}

module.exports = { RANGOS, METRICAS, contar, serie, resumen, periodo };
