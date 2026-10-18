// Rachas diarias (días seguidos ganando XP, en hora de Madrid): el bonus de XP que dan y a quién hay que avisar de que
// está a punto de perderla o la ha perdido. Los DM los manda el adaptador de Discord (src/discord/envios/rachas, #472).
const db = require("../../core/db");
const { getConfig, ensureUser } = require("./config");
const { sumarDias } = require("../../core/zonaMadrid");
const diaria = require("./diaria");

/** Desde cuántos días de racha se avisa de haberla perdido. */
const RACHA_MINIMA_AVISO = 3;

const STREAK_TIMEZONE = "Europe/Madrid";

function madridDateStr(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: STREAK_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}

function madridYesterdayStr(date = new Date()) {
    return madridDateStr(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

/** ¿Le queda un día de gracia este mes (#346)? `dia` es el día («AAAA-MM-DD») en que se mira; el mes cuenta como natural. */
function graciaDisponible(guildId, user, dia) {
    const limite = Number(getConfig(guildId, "streak_grace_per_month") || 0);
    if (!(limite > 0)) return false;
    const usados = user.streak_gracia_mes === dia.slice(0, 7) ? user.streak_gracia_usados || 0 : 0;
    return usados < limite;
}

/** Gasta un día de gracia del mes de `dia`. */
function gastarGracia(guildId, userId, user, dia) {
    const mes = dia.slice(0, 7);
    const usados = user.streak_gracia_mes === mes ? user.streak_gracia_usados || 0 : 0;
    db.prepare(`UPDATE xp_users SET streak_gracia_mes = ?, streak_gracia_usados = ? WHERE guildId = ? AND userId = ?`).run(
        mes,
        usados + 1,
        guildId,
        userId,
    );
}

/** ¿Se mantiene la racha de `user` al volver hoy? Sí si jugó ayer o si faltó solo anteayer y le queda un día de gracia. */
function continuaRacha(guildId, user, hoy) {
    if (user.streak_last_day === madridYesterdayStr()) return "ayer";
    const conGracia = user.streak_last_day === sumarDias(hoy, -2) && (user.streak_dias || 0) > 0 && graciaDisponible(guildId, user, hoy);
    return conGracia ? "gracia" : null;
}

function updateStreak(guildId, userId) {
    const user = ensureUser(guildId, userId);
    const today = madridDateStr();
    if (user.streak_last_day === today) {
        return { streakDias: user.streak_dias || 0, incremented: false };
    }
    const continua = continuaRacha(guildId, user, today);
    if (continua === "gracia") gastarGracia(guildId, userId, user, today);
    const newStreak = continua ? (user.streak_dias || 0) + 1 : 1;
    db.prepare(
        `UPDATE xp_users SET streak_dias = ?, streak_last_day = ?, streak_max = MAX(streak_max, ?) WHERE guildId = ? AND userId = ?`,
    ).run(newStreak, today, newStreak, guildId, userId);
    return { streakDias: newStreak, incremented: true };
}

function streakBonusPct(guildId, streakDias) {
    if (streakDias <= 0) return 0;
    const perDay = Number(getConfig(guildId, "streak_bonus_pct_per_day") || 2);
    const cap = Number(getConfig(guildId, "streak_bonus_cap_pct") || 50);
    return Math.min(Math.max(0, cap), Math.max(0, streakDias * perDay));
}

function getEffectiveStreak(guildId, userId) {
    const user = ensureUser(guildId, userId);
    const today = madridDateStr();
    const yesterday = madridYesterdayStr();
    if (user.streak_last_day === today || user.streak_last_day === yesterday) return user.streak_dias || 0;
    // Faltó solo anteayer y le queda un día de gracia: la racha sigue viva si hoy gana XP.
    return continuaRacha(guildId, user, today) ? user.streak_dias || 0 : 0;
}

/** A quién toca avisar de que va a perder la racha: llevaba 2+ días seguidos y ayer aún no ganó XP (racha viva). */
function avisosRachaPeligro() {
    const yesterday = madridYesterdayStr();
    return db
        .prepare(
            `
        SELECT guildId, userId, streak_dias AS streakDias
        FROM xp_users
        WHERE streak_dias >= 2 AND streak_last_day = ?
    `,
        )
        .all(yesterday)
        .filter((row) => getConfig(row.guildId, "streak_enabled") !== "0");
}

/**
 * A quién toca avisar de que ha perdido una racha de 3 días o más (#342). La racha se pierde cuando pasa un día entero sin
 * XP: el último día con XP fue anteayer. Con días de gracia la pérdida llega un día más tarde (hace 3 días), y solo si
 * entonces la gracia estaba disponible: si no, ya se avisó ayer. Así cada racha perdida se avisa una sola vez.
 */
function avisosRachaPerdida(hoy = madridDateStr()) {
    const rows = db
        .prepare(
            `SELECT guildId, userId, streak_dias AS streakDias, streak_last_day, streak_gracia_mes, streak_gracia_usados
             FROM xp_users WHERE streak_dias >= ? AND streak_last_day IN (?, ?)`,
        )
        .all(RACHA_MINIMA_AVISO, sumarDias(hoy, -2), sumarDias(hoy, -3));

    const avisos = [];
    for (const row of rows) {
        if (getConfig(row.guildId, "streak_enabled") === "0") continue;
        const anteayer = row.streak_last_day === sumarDias(hoy, -2);
        const salvadaPorGracia = graciaDisponible(row.guildId, row, anteayer ? hoy : sumarDias(hoy, -1));
        if (anteayer === salvadaPorGracia) continue;
        avisos.push({ guildId: row.guildId, userId: row.userId, streakDias: row.streakDias });
    }
    return avisos;
}

/** Borra la XP diaria vieja (se llama tras el aviso de racha perdida). */
function limpiarDiaria(hoy = madridDateStr()) {
    diaria.limpiar(hoy);
}

module.exports = {
    madridDateStr,
    updateStreak,
    streakBonusPct,
    getEffectiveStreak,
    avisosRachaPeligro,
    avisosRachaPerdida,
    limpiarDiaria,
};
