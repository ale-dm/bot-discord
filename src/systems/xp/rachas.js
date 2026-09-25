// Rachas diarias (días seguidos ganando XP, en hora de Madrid): el bonus de XP que dan, el DM al
// continuarla y el aviso diario a quien está a punto de perderla.
const db = require("../../core/db");
const { EmbedBuilder } = require("discord.js");
const { createLogger } = require("../../core/logger");
const { getConfig, ensureUser } = require("./config");

const log = createLogger("XP");

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

function updateStreak(guildId, userId) {
    const user = ensureUser(guildId, userId);
    const today = madridDateStr();
    if (user.streak_last_day === today) {
        return { streakDias: user.streak_dias || 0, incremented: false };
    }
    const yesterday = madridYesterdayStr();
    const newStreak = user.streak_last_day === yesterday ? (user.streak_dias || 0) + 1 : 1;
    db.prepare(`UPDATE xp_users SET streak_dias = ?, streak_last_day = ? WHERE guildId = ? AND userId = ?`).run(
        newStreak,
        today,
        guildId,
        userId,
    );
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
    if (user.streak_last_day !== today && user.streak_last_day !== yesterday) return 0;
    return user.streak_dias || 0;
}

async function sendDm(client, userId, payload) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(payload);
        return true;
    } catch (e) {
        // Lo normal es que tenga los DMs cerrados (código 50007): no es un error del bot.
        log.debug(`No se pudo enviar DM a ${userId}: ${e.code === 50007 ? "DMs cerrados" : e.message}`);
        return false;
    }
}

function buildStreakContinuedEmbed(guild, streakDias, bonusPct) {
    return new EmbedBuilder()
        .setTitle("🔥 ¡Racha activa!")
        .setDescription(`Llevas **${streakDias} días seguidos** ganando XP en **${guild.name}**.`)
        .addFields({ name: "Bonus actual", value: `+${bonusPct.toFixed(0)}% XP`, inline: true })
        .setColor(0xff6b35)
        .setFooter({ text: "Sigue así para no perder la racha" })
        .setTimestamp();
}

function buildStreakWarningEmbed(guild, streakDias) {
    return new EmbedBuilder()
        .setTitle("⏳ Tu racha está en peligro")
        .setDescription(
            `Llevas **${streakDias} días** de racha en **${guild.name}**, pero hoy todavía no has ganado XP.\n` +
                `Escribe un mensaje o entra a un canal de voz antes de medianoche para no perderla.`,
        )
        .setColor(0xe74c3c)
        .setTimestamp();
}

async function runStreakWarningJob(client) {
    const yesterday = madridYesterdayStr();
    const rows = db
        .prepare(
            `
        SELECT guildId, userId, streak_dias
        FROM xp_users
        WHERE streak_dias >= 2 AND streak_last_day = ?
    `,
        )
        .all(yesterday);

    let enviados = 0;
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        if (getConfig(row.guildId, "streak_enabled") === "0") continue;
        const embed = buildStreakWarningEmbed(guild, row.streak_dias);
        if (await sendDm(client, row.userId, { embeds: [embed] })) enviados++;
    }
    log.info(`Aviso de racha en peligro: ${enviados}/${rows.length} DMs enviados`);
}

module.exports = { updateStreak, streakBonusPct, getEffectiveStreak, sendDm, buildStreakContinuedEmbed, runStreakWarningJob };
