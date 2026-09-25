// Ganar XP y subir de nivel (con el bonus de racha, los logros, los roles y el anuncio), el perfil
// y el ranking, y los ajustes manuales del panel.
const db = require("../../core/db");
const achievements = require("../achievementsSystem");
const { createLogger } = require("../../core/logger");
const { ensureGuildDefaults, getConfig, ensureUser, xpForNextLevel, titleForLevel, nextTitle } = require("./config");
const { updateStreak, streakBonusPct, getEffectiveStreak, sendDm, buildStreakContinuedEmbed } = require("./rachas");
const { tryAssignRewards, maybeAnnounceLevelUp } = require("./roles");

const log = createLogger("XP");

async function addXp(guild, member, amount) {
    if (!guild || !member || amount <= 0) return null;
    const guildId = guild.id;
    const userId = member.id;
    ensureGuildDefaults(guildId);

    const multiplier = Number(getConfig(guildId, "xp_multiplier") || 1);
    let gain = Math.floor(amount * multiplier);
    if (gain <= 0) gain = 1;

    const user = ensureUser(guildId, userId);
    const oldLevel = user.nivel;

    const streakEnabled = getConfig(guildId, "streak_enabled") !== "0";
    const streak = streakEnabled ? updateStreak(guildId, userId) : { streakDias: 0, incremented: false };
    if (streakEnabled && streak.streakDias > 0) {
        const pct = streakBonusPct(guildId, streak.streakDias);
        if (pct > 0) gain = Math.max(1, Math.floor(gain * (1 + pct / 100)));
    }

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

    if (user.nivel > oldLevel) {
        const insertHistory = db.prepare(`
            INSERT INTO xp_level_history (guildId, userId, nivel, createdAt)
            VALUES (?, ?, ?, ?)
        `);
        for (let lvl = oldLevel + 1; lvl <= user.nivel; lvl++) {
            insertHistory.run(guildId, userId, lvl, Date.now());
        }
        log.info(`${userId} sube a nivel ${user.nivel} (desde ${oldLevel}) en ${guild.name}`);
        await tryAssignRewards(guild, member, oldLevel, user.nivel);
        await maybeAnnounceLevelUp(guild, member, user.nivel);
    }

    if (streakEnabled && streak.incremented && streak.streakDias >= 2) {
        const pct = streakBonusPct(guildId, streak.streakDias);
        log.debug(`${userId}: racha de ${streak.streakDias} días (+${pct}% XP)`);
        await sendDm(guild.client, userId, { embeds: [buildStreakContinuedEmbed(guild, streak.streakDias, pct)] });
    }

    return { ...user, gain, oldLevel, streak_dias: streak.streakDias, streakDias: streak.streakDias };
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
        return addXp(guild, member || { id: userId }, amount);
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

module.exports = { addXp, getProfile, getTop, getLevelHistory, adjustUserXp, resetUser };
