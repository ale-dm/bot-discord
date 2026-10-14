// La XP final (con multiplicadores y racha) que cada persona ha ganado cada día, en hora de Madrid: lo que mira el tope
// diario (#352) y los logros de XP en un solo día (#383). Se guardan dos semanas: hace falta la semana anterior entera para la clasificación semanal (#391).
const db = require("../../core/db");
const { sumarDias } = require("../../core/zonaMadrid");

const DIAS_CONSERVADOS = 14;

/** La XP que lleva ganada alguien en un día («AAAA-MM-DD»). */
function xpDeHoy(guildId, userId, dia) {
    return db.prepare("SELECT xp FROM xp_diaria WHERE guildId = ? AND userId = ? AND dia = ?").get(guildId, userId, dia)?.xp ?? 0;
}

/** Suma XP al día y devuelve el total del día. */
function sumar(guildId, userId, dia, xp) {
    db.prepare(
        `INSERT INTO xp_diaria (guildId, userId, dia, xp) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, userId, dia) DO UPDATE SET xp = xp + excluded.xp`,
    ).run(guildId, userId, dia, xp);
    return xpDeHoy(guildId, userId, dia);
}

/** Borra los días de hace más de dos semanas. */
function limpiar(hoy) {
    return db.prepare("DELETE FROM xp_diaria WHERE dia < ?").run(sumarDias(hoy, -DIAS_CONSERVADOS)).changes;
}

module.exports = { DIAS_CONSERVADOS, xpDeHoy, sumar, limpiar };
