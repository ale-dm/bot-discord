// Límites por jugador en las apuestas (F-AP-09), configurables en /paneladmin → ⚽ Apuestas → 🚦 Límites (0 = sin
// límite, como los del casino y la tienda):
// - Tope diario: lo que cada uno puede apostar en un día (hora de Madrid), sumando partidos y quiniela. Sale del
//   historial (todo lo apostado se apunta en negativo con tipo "apuestas"), así que también cuenta lo apostado y
//   devuelto después.
// - Máximo por partido: lo que cada uno puede tener apostado a un mismo partido, sumando todas sus apuestas a él.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { fmtNumero } = require("../../core/formato");

const ZONA = "Europe/Madrid";
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const diaDe = (fecha) => formatoDia.format(new Date(fecha));

/** Lo que ha apostado hoy (hora de Madrid) en partidos y quinielas. */
function apostadoHoy(userId, ahora = Date.now()) {
    const hoy = diaDe(ahora);
    // Un margen de dos días en SQL (las fechas son texto ISO en UTC) y el día exacto, en hora de Madrid.
    return db
        .prepare("SELECT fecha, cantidad FROM historial WHERE userId = ? AND tipo = 'apuestas' AND cantidad < 0 AND fecha >= ?")
        .all(String(userId), new Date(ahora - 2 * 86400 * 1000).toISOString())
        .filter((f) => diaDe(f.fecha) === hoy)
        .reduce((total, f) => total - f.cantidad, 0);
}

/** Lo que tiene apostado a un partido, sumando todas sus apuestas a él. */
function apostadoEnPartido(userId, matchId) {
    return db
        .prepare("SELECT COALESCE(SUM(cantidad), 0) AS total FROM apuestas_usuario WHERE user_id = ? AND match_id = ?")
        .get(String(userId), matchId).total;
}

/** Los límites de un servidor ({ topeDiario, maxPartido }, 0 = sin límite). */
function limites(guildId) {
    const cfg = guildSettings.getSettings(guildId).apuestas;
    return { topeDiario: Math.max(0, Number(cfg.tope_diario) || 0), maxPartido: Math.max(0, Number(cfg.max_partido) || 0) };
}

/**
 * ¿Puede apostar `cantidad` ahora? `matchId`: si es a un partido (la quiniela solo cuenta para el tope diario).
 * @returns {string|null} el motivo si se pasa de algún límite, o null si puede
 */
function comprobar(guildId, userId, cantidad, { matchId = null, ahora = Date.now() } = {}) {
    const { topeDiario, maxPartido } = limites(guildId);
    if (topeDiario) {
        const hoy = apostadoHoy(userId, ahora);
        if (hoy + cantidad > topeDiario) {
            const queda = Math.max(0, topeDiario - hoy);
            return (
                `Hoy ya has apostado **${fmtNumero(hoy)}** 🪙 y el tope diario es de **${fmtNumero(topeDiario)}** 🪙: ` +
                (queda ? `como mucho puedes apostar **${fmtNumero(queda)}** 🪙 más hasta mañana.` : "hasta mañana no puedes apostar más.")
            );
        }
    }
    if (matchId && maxPartido) {
        const enPartido = apostadoEnPartido(userId, matchId);
        if (enPartido + cantidad > maxPartido) {
            const queda = Math.max(0, maxPartido - enPartido);
            return (
                `El máximo por partido es de **${fmtNumero(maxPartido)}** 🪙` +
                (enPartido ? ` y en este ya tienes **${fmtNumero(enPartido)}** 🪙` : "") +
                (queda ? `: como mucho puedes apostar **${fmtNumero(queda)}** 🪙 más.` : ": a este ya no puedes apostar más.")
            );
        }
    }
    return null;
}

module.exports = { apostadoHoy, apostadoEnPartido, limites, comprobar };
