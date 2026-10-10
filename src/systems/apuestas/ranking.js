// Ranking de apostadores (F-AP-03): beneficio, % de acierto y mejor racha de cada uno, con lo que ya se guarda de cada
// apuesta (su premio: 0 si se perdió). Lo enseña /perfil → 🏆 Rankings → ⚽ Apostadores; el de una semana
// (beneficioEntre), la clasificación semanal con premios (F-EC-03).
//
// El beneficio es el mismo que el de 📊 Stats (partidos y quinielas ya resueltos, ver misJugadas.estadisticas); el
// acierto y la racha, solo de las apuestas a partidos (una quiniela no se gana o se pierde entera).
const db = require("../../core/db");
const { estadisticas, estadisticasVacias, estadisticasDeTodos } = require("./misJugadas");

/** Apuestas resueltas (partidos y quinielas) que hacen falta para salir en el ranking. */
const MIN_RESUELTAS = 5;

/** Cuántas apuestas a partidos ganó seguidas como mucho, por orden de partido. */
function mejorRacha(userId) {
    const filas = db
        .prepare(
            `SELECT a.premio FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.user_id = ? AND p.estado = 'finalizado' AND a.premio IS NOT NULL
             ORDER BY p.start_time, a.id`,
        )
        .all(userId);
    let mejor = 0;
    let actual = 0;
    for (const f of filas) {
        actual = f.premio > 0 ? actual + 1 : 0;
        mejor = Math.max(mejor, actual);
    }
    return mejor;
}

/** Las cifras de un apostador a partir de sus estadísticas (estadisticas), sin la racha. */
function calcular(userId, { partidos: p, quinielas: q }) {
    const decididas = p.ganadas + p.perdidas;
    return {
        userId,
        beneficio: p.ganado - p.apostado + (q.ganado - q.apostado),
        resueltas: decididas + (q.total - q.pendientes),
        ganadas: p.ganadas,
        perdidas: p.perdidas,
        acierto: decididas ? (p.ganadas / decididas) * 100 : null,
    };
}

/** Las cifras de un apostador: beneficio, apuestas resueltas, acierto (null sin partidos resueltos) y mejor racha. */
function cifras(userId) {
    return { ...calcular(userId, estadisticas(userId)), racha: mejorRacha(userId) };
}

/**
 * Los mejores apostadores por beneficio (a igualdad, más acierto), de quienes tienen al menos `minimo` apuestas resueltas.
 * Las estadísticas de todos salen de dos consultas agrupadas (estadisticasDeTodos), no de una por apostador, y la racha
 * solo se calcula para los que se devuelven: no influye en el orden. Con 50.000 apostadores tardaba 7 s y bloqueaba el bot.
 * @returns {{ userId: string, beneficio: number, resueltas: number, ganadas: number, perdidas: number, acierto: number|null, racha: number }[]}
 */
function ranking({ limite = 10, minimo = MIN_RESUELTAS } = {}) {
    const ids = db
        .prepare("SELECT user_id FROM apuestas_usuario UNION SELECT user_id FROM quiniela_apuestas")
        .all()
        .map((r) => r.user_id)
        .filter(Boolean);
    const porUsuario = estadisticasDeTodos();
    return ids
        .map((id) => calcular(id, porUsuario.get(id) ?? estadisticasVacias()))
        .filter((c) => c.resueltas >= minimo)
        .sort((a, b) => b.beneficio - a.beneficio || (b.acierto ?? -1) - (a.acierto ?? -1))
        .slice(0, limite)
        .map((c) => ({ ...c, racha: mejorRacha(c.userId) }));
}

const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const diaDe = (fecha) => formatoDia.format(new Date(fecha));

/**
 * El beneficio de cada uno en lo resuelto entre dos días (AAAA-MM-DD, hora de Madrid, ambos incluidos): partidos por el día
 * del partido y quinielas por el día en que se cerraron (las devueltas cuentan como recuperadas). De más a menos; solo
 * quien tiene algo resuelto esos días. Lo usa la clasificación semanal (F-EC-03) para el mejor apostador.
 * @returns {{ userId: string, beneficio: number, resueltas: number }[]}
 */
function beneficioEntre(desde, hasta) {
    // Un día de margen en SQL (las fechas son texto ISO en UTC) y el día exacto, en hora de Madrid.
    const margenDesde = new Date(Date.parse(`${desde}T00:00:00Z`) - 86400 * 1000).toISOString();
    const margenHasta = new Date(Date.parse(`${hasta}T00:00:00Z`) + 2 * 86400 * 1000).toISOString();
    const enRango = (f) => diaDe(f.fecha) >= desde && diaDe(f.fecha) <= hasta;
    const partidos = db
        .prepare(
            `SELECT a.user_id, a.cantidad, a.premio, p.start_time AS fecha FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE p.estado = 'finalizado' AND a.premio IS NOT NULL AND p.start_time >= ? AND p.start_time < ?`,
        )
        .all(margenDesde, margenHasta)
        .filter(enRango);
    const quinielas = db
        .prepare(
            `SELECT qa.user_id, qa.cantidad, qa.premio, q.cerrada_en AS fecha,
                (q.estado = 'caducada' OR NOT EXISTS (SELECT 1 FROM quiniela_apuestas x WHERE x.quiniela_id = q.id AND x.premio > 0)) AS devuelta
             FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id
             WHERE q.estado != 'abierta' AND q.cerrada_en >= ? AND q.cerrada_en < ?`,
        )
        .all(margenDesde, margenHasta)
        .filter(enRango);
    const porUsuario = new Map();
    const sumar = (userId, beneficio) => {
        const u = porUsuario.get(userId) || { userId, beneficio: 0, resueltas: 0 };
        u.beneficio += beneficio;
        u.resueltas++;
        porUsuario.set(userId, u);
    };
    for (const a of partidos) sumar(a.user_id, a.premio - a.cantidad);
    for (const q of quinielas) sumar(q.user_id, (q.devuelta ? q.cantidad : q.premio) - q.cantidad);
    return [...porUsuario.values()].sort((a, b) => b.beneficio - a.beneficio || b.resueltas - a.resueltas);
}

module.exports = { MIN_RESUELTAS, cifras, ranking, beneficioEntre };
