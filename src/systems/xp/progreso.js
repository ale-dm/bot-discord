// Ganar XP y subir de nivel (con el bonus de racha, los logros, los roles y el anuncio), el perfil
// y el ranking, y los ajustes manuales del panel.
const db = require("../../core/db");
const achievements = require("../achievementsSystem");
const { createLogger } = require("../../core/logger");
const { ensureGuildDefaults, getConfig, ensureUser, xpForNextLevel, titleForLevel, nextTitle } = require("./config");
const { madridDateStr, updateStreak, streakBonusPct, getEffectiveStreak } = require("./rachas");
const diaria = require("./diaria");
const eventos = require("../eventos");

const log = createLogger("XP");

/** La XP de una ganancia: el multiplicador global, el del evento y el del canal, y el bonus de la racha. */
function calcularGanancia(guildId, amount, streak, multiplicadorCanal) {
    // El multiplicador global y, en la ⚡ happy hour (F-EC-02), el del evento.
    const multiplier = Number(getConfig(guildId, "xp_multiplier") || 1) * eventos.multiplicadorXp(guildId) * multiplicadorCanal;
    let gain = Math.floor(amount * multiplier);
    if (gain <= 0) gain = 1;
    if (streak.streakDias > 0) {
        const pct = streakBonusPct(guildId, streak.streakDias);
        if (pct > 0) gain = Math.max(1, Math.floor(gain * (1 + pct / 100)));
    }
    return gain;
}

/** Recorta la ganancia a lo que queda del tope diario de XP (#352); sin tope (0) no cambia. */
function recortarAlTope(guildId, userId, gain, dia) {
    const tope = Number(getConfig(guildId, "xp_daily_cap") || 0);
    if (!(tope > 0)) return gain;
    return Math.max(0, Math.min(gain, tope - diaria.xpDeHoy(guildId, userId, dia)));
}

/**
 * Da XP a alguien. `opciones.multiplicadorCanal` (1 por defecto) es el del canal donde la ha ganado (#369);
 * `opciones.manual` es un ajuste de un admin: no se recorta al tope diario ni cuenta como XP del día.
 */
async function addXp(guild, member, amount, opciones = {}) {
    if (!guild || !member || amount <= 0) return null;
    const guildId = guild.id;
    const userId = member.id;
    ensureGuildDefaults(guildId);

    const user = ensureUser(guildId, userId);
    const oldLevel = user.nivel;

    const streakEnabled = getConfig(guildId, "streak_enabled") !== "0";
    const streak = streakEnabled ? updateStreak(guildId, userId) : { streakDias: 0, incremented: false };
    if (streak.incremented) await achievements.applyEvent(guild, userId, "streak_days", streak.streakDias);

    const dia = madridDateStr();
    let gain = calcularGanancia(guildId, amount, streak, opciones.multiplicadorCanal ?? 1);
    if (!opciones.manual) gain = recortarAlTope(guildId, userId, gain, dia);
    // Qué ha cambiado (subida de nivel, racha que se continúa): el adaptador de Discord lo pinta (src/discord/envios/xp).
    const efectos = { subidaNivel: null, rachaActiva: null };
    const resultado = { gain, oldLevel, streak_dias: streak.streakDias, streakDias: streak.streakDias, eventos: efectos };
    if (gain <= 0) return { ...user, ...resultado };

    user.xp += gain;
    user.xp_total += gain;

    while (user.xp >= xpForNextLevel(user.nivel, guildId, userId)) {
        user.xp -= xpForNextLevel(user.nivel, guildId, userId);
        user.nivel += 1;
    }

    db.prepare(
        `
        UPDATE xp_users
        SET xp = ?, nivel = ?, xp_total = ?
        WHERE guildId = ? AND userId = ?
    `,
    ).run(user.xp, user.nivel, user.xp_total, guildId, userId);

    await achievements.applyEvent(guild, userId, "xp_gain", gain);
    await achievements.applyEvent(guild, userId, "xp_level", user.nivel);
    if (!opciones.manual) await achievements.applyEvent(guild, userId, "xp_dia", diaria.sumar(guildId, userId, dia, gain));

    if (user.nivel > oldLevel) {
        await registrarSubida(guild, guildId, userId, oldLevel, user.nivel);
        efectos.subidaNivel = { oldLevel, newLevel: user.nivel };
    }

    if (streakEnabled && streak.incremented && streak.streakDias >= 2) {
        const pct = streakBonusPct(guildId, streak.streakDias);
        log.debug(`${userId}: racha de ${streak.streakDias} días (+${pct}% XP)`);
        efectos.rachaActiva = { streakDias: streak.streakDias, pct };
    }

    return { ...user, ...resultado };
}

/** Guarda cada nivel nuevo en el historial (los roles y el anuncio los pinta el adaptador de Discord). */
async function registrarSubida(guild, guildId, userId, oldLevel, nivel) {
    const insertHistory = db.prepare(`
            INSERT INTO xp_level_history (guildId, userId, nivel, createdAt)
            VALUES (?, ?, ?, ?)
        `);
    for (let lvl = oldLevel + 1; lvl <= nivel; lvl++) {
        insertHistory.run(guildId, userId, lvl, Date.now());
    }
    log.info(`${userId} sube a nivel ${nivel} (desde ${oldLevel}) en ${guild.name}`);
}

function getProfile(guildId, userId) {
    ensureGuildDefaults(guildId);
    const user = ensureUser(guildId, userId);
    const need = xpForNextLevel(user.nivel, guildId, userId);
    const rank =
        db
            .prepare(
                `
        SELECT COUNT(*) + 1 AS pos
        FROM xp_users
        WHERE guildId = ? AND xp_total > ?
    `,
            )
            .get(guildId, user.xp_total)?.pos || 1;
    const title = titleForLevel(guildId, user.nivel);
    const next = nextTitle(guildId, user.nivel);
    const streak = getEffectiveStreak(guildId, userId);
    return {
        ...user,
        xp_need: need,
        rank,
        title,
        nextTitle: next,
        streak,
        streakBonusPct: streakBonusPct(guildId, streak),
    };
}

function getTop(guildId, limit = 10, offset = 0) {
    ensureGuildDefaults(guildId);
    return db
        .prepare(
            `
        SELECT userId, nivel, xp_total
        FROM xp_users
        WHERE guildId = ?
        ORDER BY xp_total DESC
        LIMIT ? OFFSET ?
    `,
        )
        .all(guildId, limit, offset);
}

/** 🔥 Ranking de rachas (#339): por mejor racha; cada fila lleva también la racha actual. */
function getTopRachas(guildId, limit = 10) {
    ensureGuildDefaults(guildId);
    return db
        .prepare(
            `SELECT userId, streak_max FROM xp_users WHERE guildId = ? AND streak_max > 0 ORDER BY streak_max DESC, xp_total DESC LIMIT ?`,
        )
        .all(guildId, limit)
        .map((r) => ({ userId: r.userId, mejor: r.streak_max, actual: getEffectiveStreak(guildId, r.userId) }));
}

/** El puesto de alguien en el ranking de rachas y su mejor racha, o null si aún no tiene ninguna. */
function puestoRacha(guildId, userId) {
    const mejor = db.prepare(`SELECT streak_max FROM xp_users WHERE guildId = ? AND userId = ?`).get(guildId, userId)?.streak_max || 0;
    if (!mejor) return null;
    const delante = db.prepare(`SELECT COUNT(*) AS n FROM xp_users WHERE guildId = ? AND streak_max > ?`).get(guildId, mejor).n;
    return { puesto: delante + 1, mejor };
}

function getLevelHistory(guildId, userId, limit = 5) {
    ensureGuildDefaults(guildId);
    return db
        .prepare(
            `
        SELECT nivel, createdAt
        FROM xp_level_history
        WHERE guildId = ? AND userId = ?
        ORDER BY createdAt DESC
        LIMIT ?
    `,
        )
        .all(guildId, userId, Math.max(1, Math.min(20, Number(limit) || 5)));
}

async function adjustUserXp(guild, userId, amount) {
    const guildId = guild.id;
    ensureUser(guildId, userId);
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));

    log.info(`Ajuste manual de XP a ${userId} en ${guild.name}: ${amount >= 0 ? "+" : ""}${amount}`);
    if (amount >= 0) {
        return addXp(guild, member || { id: userId }, amount, { manual: true });
    }

    const user = ensureUser(guildId, userId);
    const remove = Math.abs(amount);
    const newTotal = Math.max(0, user.xp_total - remove);

    let level = 0;
    let remaining = newTotal;
    while (remaining >= xpForNextLevel(level, guildId, userId)) {
        remaining -= xpForNextLevel(level, guildId, userId);
        level += 1;
        if (level > 9999) break;
    }

    db.prepare(`UPDATE xp_users SET xp_total = ?, nivel = ?, xp = ? WHERE guildId = ? AND userId = ?`).run(
        newTotal,
        level,
        remaining,
        guildId,
        userId,
    );

    return ensureUser(guildId, userId);
}

function resetUser(guildId, userId) {
    db.prepare(`DELETE FROM xp_users WHERE guildId = ? AND userId = ?`).run(guildId, userId);
    log.info(`XP reseteada para ${userId} en ${guildId}`);
}

module.exports = { addXp, getProfile, getTop, getTopRachas, puestoRacha, getLevelHistory, adjustUserXp, resetUser };
