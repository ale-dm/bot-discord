// 🎞️ Plex Wrapped mensual (#23): el día 1 de cada mes, desde las 10:00 (hora de Madrid), cada persona con la cuenta de Plex
// vinculada recibe por DM su propio resumen del mes anterior: sus horas vistas, sus películas y episodios, y sus series más
// vistas. Es privado: no se publica nada en ningún canal ni se muestran datos de otras personas. Usa la copia local del
// historial (plex_reproducciones), como el ranking semanal. Una vez por mes y persona (plex_wrapped_enviados).
const db = require("../core/db");
const avisosDm = require("./avisosDm");
const plexLinks = require("./plexLinks");
const plexHistorial = require("./plexHistorial");
const { renderPng, FONDO, TEXTO, TEXTO_SUAVE, REJILLA } = require("./cripto/graficos");
const HORA = 10;
const TOP_SERIES = 5;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA_MS = 86400 * 1000;
const aFecha = (dia) => new Date(`${dia}T00:00:00Z`);
const sumarDias = (dia, n) => new Date(aFecha(dia).getTime() + n * DIA_MS).toISOString().slice(0, 10);
const horas = (segundos) => Math.round((segundos / 3600) * 10) / 10;
const fmtH = (n) => `${String(n.toFixed(1)).replace(".", ",")} h`;

/** El mes anterior al de `ahora` (hora de Madrid): { mes: "2026-09", inicio, fin, etiqueta }. */
function mesAnterior(ahora = Date.now()) {
    const { dia } = plexHistorial.momento(Math.floor(ahora / 1000));
    const [y, m] = dia.split("-").map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const mes = `${py}-${String(pm).padStart(2, "0")}`;
    return {
        mes,
        inicio: `${mes}-01`,
        fin: new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10),
        etiqueta: `${MESES[pm - 1]} de ${py}`,
    };
}

/** El año anterior al de `ahora` (hora de Madrid), con la misma forma que mesAnterior (#381): { mes: "2026", inicio, fin, etiqueta, anual: true }. */
function anioAnterior(ahora = Date.now()) {
    const { dia } = plexHistorial.momento(Math.floor(ahora / 1000));
    const anio = Number(dia.slice(0, 4)) - 1;
    return { mes: String(anio), inicio: `${anio}-01-01`, fin: `${anio}-12-31`, etiqueta: String(anio), anual: true };
}

/**
 * Lo que ha visto UNA persona (su cuenta de Plex) en el mes: horas, películas y episodios distintos, y sus series más vistas.
 * Solo sus datos: nada de otras personas.
 */
function resumenPersonal(guildId, tautulliUserId, mes) {
    const desde = aFecha(mes.inicio).getTime() / 1000 - 86400;
    const hasta = aFecha(sumarDias(mes.fin, 1)).getTime() / 1000 + 86400;
    const filas = db
        .prepare(
            `SELECT tipo, rating_key, serie, titulo, inicio, segundos, visto FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND inicio >= ? AND inicio < ?`,
        )
        .all(String(guildId), String(tautulliUserId), desde, hasta);
    let segundos = 0;
    const pelis = new Set();
    const eps = new Set();
    const series = new Map();
    for (const f of filas) {
        const { dia } = plexHistorial.momento(f.inicio);
        if (dia < mes.inicio || dia > mes.fin) continue;
        segundos += f.segundos;
        if (f.visto && f.rating_key) (f.tipo === "movie" ? pelis : eps).add(f.rating_key);
        if (f.tipo === "episode") {
            const nombre = f.serie || f.titulo;
            if (nombre) series.set(nombre, (series.get(nombre) || 0) + f.segundos);
        }
    }
    return {
        mes: mes.mes,
        etiqueta: mes.etiqueta,
        anual: Boolean(mes.anual),
        horas: horas(segundos),
        peliculas: pelis.size,
        episodios: eps.size,
        series: [...series.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_SERIES)
            .map(([nombre, s]) => ({ nombre, horas: horas(s) })),
    };
}

/** El texto del resumen de una persona (para el DM y para el botón de /plex). */
function mensajePersonal(r) {
    if (r.horas <= 0) return `🎞️ **Tu Plex Wrapped · ${r.etiqueta}**\n\n${r.anual ? "Ese año" : "Este mes"} no has visto nada en Plex. 😴`;
    const lineas = [
        `🎞️ **Tu Plex Wrapped · ${r.etiqueta}**`,
        "",
        `Has visto **${fmtH(r.horas)}** de Plex (${r.peliculas} ${r.peliculas === 1 ? "película" : "películas"} y ${r.episodios} ${r.episodios === 1 ? "episodio" : "episodios"}).`,
    ];
    if (r.series.length) lineas.push(`📺 Tus series: ${r.series.map((s, i) => `${i + 1}. ${s.nombre} (${fmtH(s.horas)})`).join(" · ")}`);
    return lineas.join("\n");
}

/** La gráfica de tus series del mes (PNG), o null si no has visto series. */
function graficoPersonal(r) {
    if (!r.series.length) return null;
    const orden = [...r.series].reverse();
    return renderPng(
        {
            title: {
                text: `Tu Plex Wrapped · ${r.etiqueta}`,
                subtext: `${fmtH(r.horas)} vistas en total`,
                left: 40,
                top: 22,
                textStyle: { color: TEXTO, fontSize: 22, fontWeight: "bold" },
                subtextStyle: { color: TEXTO_SUAVE, fontSize: 15 },
            },
            grid: { left: 200, right: 90, top: 100, bottom: 40 },
            xAxis: { type: "value", axisLabel: { color: TEXTO_SUAVE, fontSize: 12 }, splitLine: { lineStyle: { color: REJILLA } } },
            yAxis: {
                type: "category",
                data: orden.map((s) => s.nombre),
                axisLabel: { color: TEXTO, fontSize: 14 },
                axisTick: { show: false },
            },
            series: [
                {
                    type: "bar",
                    data: orden.map((s) => s.horas),
                    itemStyle: { color: "#e5a00d", borderRadius: [0, 6, 6, 0] },
                    label: { show: true, position: "right", color: TEXTO, fontSize: 13, formatter: (x) => fmtH(x.value) },
                },
            ],
            backgroundColor: FONDO,
        },
        900,
        Math.max(260, 110 + orden.length * 56),
    );
}

// El registro de lo enviado: el del mes (plex_wrapped_enviados) o el del año (#381, plex_wrapped_anual_enviados).
const registro = (mes) =>
    mes.anual ? { tabla: "plex_wrapped_anual_enviados", columna: "anio" } : { tabla: "plex_wrapped_enviados", columna: "mes" };

const yaEnviado = (guildId, tautulliUserId, mes) => {
    const { tabla, columna } = registro(mes);
    return Boolean(
        db
            .prepare(`SELECT 1 FROM ${tabla} WHERE guildId = ? AND tautulliUserId = ? AND ${columna} = ?`)
            .get(String(guildId), String(tautulliUserId), mes.mes),
    );
};

/**
 * Las personas a las que les toca el resumen de ese mes en un servidor: las vinculadas, que han visto algo, que no lo
 * tienen ya y que no lo han silenciado. Devuelve los datos para que el adaptador de Discord mande el DM.
 */
function pendientesDe(guildId, mes) {
    const pendientes = [];
    for (const link of plexLinks.getLinks(guildId)) {
        if (yaEnviado(guildId, link.tautulliUserId, mes)) continue;
        const resumen = resumenPersonal(guildId, link.tautulliUserId, mes);
        if (resumen.horas <= 0) continue;
        if (avisosDm.silenciado(link.discordUserId, "wrapped")) continue;
        pendientes.push({
            discordUserId: link.discordUserId,
            tautulliUserId: link.tautulliUserId,
            plexUsername: link.plexUsername,
            resumen,
        });
    }
    return pendientes;
}

/** Apunta que el resumen de esa persona y ese mes ya se ha mandado (una vez por mes y persona). */
function registrarEnviado(guildId, tautulliUserId, mes) {
    const { tabla, columna } = registro(mes);
    db.prepare(`INSERT INTO ${tabla} (guildId, tautulliUserId, ${columna}, enviado_en) VALUES (?, ?, ?, ?)`).run(
        String(guildId),
        String(tautulliUserId),
        mes.mes,
        Date.now(),
    );
}

module.exports = { HORA, mesAnterior, anioAnterior, resumenPersonal, mensajePersonal, graficoPersonal, pendientesDe, registrarEnviado };
