const db = require("../core/db");
const { EmbedBuilder } = require("discord.js");
const achievements = require("./achievementsSystem");
const { createLogger } = require("../core/logger");

const log = createLogger("XP");

const DEFAULT_CONFIG = {
    xp_message_base: "15",
    xp_message_len_bonus_max: "10",
    xp_message_cooldown_sec: "15",
    xp_voice_per_min: "5",
    xp_multiplier: "1",
    xp_announce_channel_id: "",
    xp_formula_base: "100",
    xp_formula_exp: "1.5",
    xp_level_cost_multiplier: "1.6",
    xp_level_requirement_multiplier: "10",
    streak_enabled: "1",
    streak_bonus_pct_per_day: "2",
    streak_bonus_cap_pct: "50",
};

const STREAK_TIMEZONE = "Europe/Madrid";

const DEFAULT_TITLES = [
    { level: 2, title: "BRONCE", emoji: "🥉" },
    { level: 10, title: "PLATA", emoji: "🥈" },
    { level: 15, title: "ORO", emoji: "🥇" },
    { level: 20, title: "PLATINO", emoji: "💠" },
    { level: 30, title: "DIAMANTE", emoji: "💎" },
    { level: 40, title: "MASTER", emoji: "🔷" },
    { level: 50, title: "GRANDMASTER", emoji: "🔹" },
    { level: 60, title: "PERRO", emoji: "🐶" },
    { level: 70, title: "MAMUT", emoji: "🦣" },
];

function nowMs() {
    return Date.now();
}

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

// Valores por defecto de un servidor: las claves de configuración que falten y los títulos
// de rango si no tiene ninguno. Solo rellena lo que no existe, así que nunca pisa lo que se
// cambie desde el panel. Se hace una vez por servidor y proceso (se llamaba en cada mensaje).
// (Roles de recompensa, canal de anuncios y multiplicadores ya no se siembran aquí:
// ver core/migrations/002_xp_valores_por_defecto.js.)
const seededGuilds = new Set();

function ensureGuildDefaults(guildId) {
    if (seededGuilds.has(guildId)) return;
    const insertCfg = db.prepare(`INSERT OR IGNORE INTO xp_config (guildId, clave, valor) VALUES (?, ?, ?)`);
    db.transaction(() => {
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) insertCfg.run(guildId, k, v);
        const countTitles = db.prepare(`SELECT COUNT(*) AS total FROM xp_level_titles WHERE guildId = ?`).get(guildId)?.total || 0;
        if (!countTitles) {
            const insertTitle = db.prepare(`INSERT INTO xp_level_titles (guildId, nivel, title, emoji) VALUES (?, ?, ?, ?)`);
            for (const t of DEFAULT_TITLES) insertTitle.run(guildId, t.level, t.title, t.emoji);
        }
    })();
    seededGuilds.add(guildId);
}

function getConfig(guildId, key) {
    ensureGuildDefaults(guildId);
    return db.prepare(`SELECT valor FROM xp_config WHERE guildId = ? AND clave = ?`).get(guildId, key)?.valor;
}

function getAllConfig(guildId) {
    ensureGuildDefaults(guildId);
    const rows = db.prepare(`SELECT clave, valor FROM xp_config WHERE guildId = ?`).all(guildId);
    const out = {};
    for (const r of rows) out[r.clave] = r.valor;
    return out;
}

function setConfig(guildId, key, value) {
    ensureGuildDefaults(guildId);
    db.prepare(
        `
        INSERT INTO xp_config (guildId, clave, valor) VALUES (?, ?, ?)
        ON CONFLICT(guildId, clave) DO UPDATE SET valor = excluded.valor
    `,
    ).run(guildId, key, String(value));
}

function ensureUser(guildId, userId) {
    db.prepare(`INSERT OR IGNORE INTO xp_users (guildId, userId) VALUES (?, ?)`).run(guildId, userId);
    return db.prepare(`SELECT * FROM xp_users WHERE guildId = ? AND userId = ?`).get(guildId, userId);
}

function getUserCostMultiplier(guildId, userId) {
    if (!userId) return 1;
    const row = db.prepare(`SELECT costMultiplier FROM xp_user_overrides WHERE guildId = ? AND userId = ?`).get(guildId, userId);
    return row ? Number(row.costMultiplier) : 1;
}

function setUserCostMultiplier(guildId, userId, multiplier) {
    const mult = Math.max(0.01, Number(multiplier) || 1);
    db.prepare(
        `
        INSERT INTO xp_user_overrides (guildId, userId, costMultiplier) VALUES (?, ?, ?)
        ON CONFLICT(guildId, userId) DO UPDATE SET costMultiplier = excluded.costMultiplier
    `,
    ).run(guildId, userId, mult);
}

function removeUserCostMultiplier(guildId, userId) {
    db.prepare(`DELETE FROM xp_user_overrides WHERE guildId = ? AND userId = ?`).run(guildId, userId);
}

function xpForNextLevel(level, guildId, userId = null) {
    const base = Number(getConfig(guildId, "xp_formula_base") || 100);
    const exp = Number(getConfig(guildId, "xp_formula_exp") || 1.5);
    const costMult = Number(getConfig(guildId, "xp_level_cost_multiplier") || 1.6);
    const requirementMult = Number(getConfig(guildId, "xp_level_requirement_multiplier") || 10);
    const userCostMult = getUserCostMultiplier(guildId, userId);
    return Math.max(1, Math.floor(base * Math.pow(level + 1, exp) * Math.max(1, costMult) * Math.max(1, requirementMult) * userCostMult));
}

function titleForLevel(guildId, level) {
    ensureGuildDefaults(guildId);
    return (
        db
            .prepare(
                `
        SELECT nivel, title, emoji
        FROM xp_level_titles
        WHERE guildId = ? AND nivel <= ?
        ORDER BY nivel DESC
        LIMIT 1
    `,
            )
            .get(guildId, level) || { nivel: 0, title: "SIN RANGO", emoji: "▫️" }
    );
}

function nextTitle(guildId, level) {
    ensureGuildDefaults(guildId);
    return (
        db
            .prepare(
                `
        SELECT nivel, title, emoji
        FROM xp_level_titles
        WHERE guildId = ? AND nivel > ?
        ORDER BY nivel ASC
        LIMIT 1
    `,
            )
            .get(guildId, level) || null
    );
}

async function tryAssignRewards(guild, member, oldLevel, newLevel) {
    if (!guild || !member) return;
    const rewards = db
        .prepare(
            `
        SELECT nivel, roleId FROM xp_role_rewards
        WHERE guildId = ? AND nivel > ? AND nivel <= ?
        ORDER BY nivel ASC
    `,
        )
        .all(guild.id, oldLevel, newLevel);

    for (const reward of rewards) {
        const role = guild.roles.cache.get(reward.roleId);
        if (!role) {
            log.warn(`Recompensa de nivel ${reward.nivel}: el rol ${reward.roleId} ya no existe en ${guild.name}`);
            continue;
        }
        try {
            await member.roles.add(role);
            log.info(`Rol "${role.name}" (nivel ${reward.nivel}) asignado a ${member.id}`);
        } catch (e) {
            // Normalmente: el rol está por encima del rol del bot o falta "Gestionar roles".
            log.warn(`No se pudo asignar el rol "${role.name}" (nivel ${reward.nivel}) a ${member.id}: ${e.message}`);
        }
    }
}

async function maybeAnnounceLevelUp(guild, member, newLevel) {
    if (!guild || !member) return;
    const channelId = getConfig(guild.id, "xp_announce_channel_id");
    if (!channelId) {
        log.debug(`${guild.name}: sin canal de anuncios de nivel configurado; no se anuncia el nivel ${newLevel} de ${member.id}`);
        return;
    }

    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal de anuncios de nivel ${channelId} no encontrado o no es de texto en ${guild.name}`);
        return;
    }

    const mention = member?.toString?.() || `<@${member.id}>`;
    const currentTitle = titleForLevel(guild.id, newLevel);
    const upcomingTitle = nextTitle(guild.id, newLevel);
    const nextNeed = xpForNextLevel(newLevel, guild.id, member.id);
    const rewardRole = db.prepare("SELECT roleId, roleName FROM xp_role_rewards WHERE guildId = ? AND nivel = ?").get(guild.id, newLevel);

    const embed = new EmbedBuilder()
        .setTitle("🎉 ¡Subida de nivel!")
        .setDescription(`${mention} alcanzó el **Nivel ${newLevel}**`)
        .addFields(
            { name: "Rango actual", value: `${currentTitle.emoji || "▫️"} **${currentTitle.title || "SIN RANGO"}**`, inline: true },
            { name: "XP próximo nivel", value: `${nextNeed}`, inline: true },
            {
                name: "Siguiente rango",
                value: upcomingTitle
                    ? `${upcomingTitle.emoji || "▫️"} ${upcomingTitle.title} (LV ${upcomingTitle.nivel})`
                    : "🏁 Máximo rango",
                inline: true,
            },
            {
                name: "Recompensa de nivel",
                value: rewardRole?.roleId ? `<@&${rewardRole.roleId}>` : "Sin recompensa de rol en este nivel",
                inline: false,
            },
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Servidor: ${guild.name}` })
        .setTimestamp();

    try {
        await channel.send({ embeds: [embed] });
    } catch (e) {
        log.warn(`No se pudo anunciar la subida de nivel de ${member.id} en #${channel.name}:`, e.message);
    }
}

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
            insertHistory.run(guildId, userId, lvl, nowMs());
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

function isIgnoredChannel(guildId, channelId) {
    if (!channelId) return false;
    return !!db.prepare(`SELECT 1 FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?`).get(guildId, channelId);
}

function hasOtherActiveMembers(voiceState) {
    const channel = voiceState?.channel;
    if (!channel) return true; // channel not cached: don't block XP on a cache miss
    const nonBotMembers = channel.members.filter((m) => !m.user?.bot).size;
    return nonBotMembers >= 2;
}

function isVoiceXpEligible(voiceState) {
    if (!voiceState?.channelId) return false;
    const muted = Boolean(voiceState.selfMute || voiceState.serverMute || voiceState.mute);
    const deafened = Boolean(voiceState.selfDeaf || voiceState.serverDeaf || voiceState.deaf);
    if (muted || deafened) return false;
    return hasOtherActiveMembers(voiceState);
}

function voiceIneligibleReason(voiceState) {
    const muted = Boolean(voiceState?.selfMute || voiceState?.serverMute || voiceState?.mute);
    const deafened = Boolean(voiceState?.selfDeaf || voiceState?.serverDeaf || voiceState?.deaf);
    if (muted && deafened) return "muteado y ensordecido";
    if (muted) return "muteado";
    if (deafened) return "ensordecido";
    if (!voiceState?.channelId) return "fuera de canal de voz";
    if (!hasOtherActiveMembers(voiceState)) return "solo en el canal";
    return "no elegible";
}

function effectiveMessageLength(content) {
    const trimmed = (content || "").trim();
    if (!trimmed) return 0;
    // Collapse runs of 3+ repeated characters so filler spam ("aaaaaaaa") can't farm the length bonus
    return trimmed.replace(/(.)\1{2,}/g, "$1$1").length;
}

async function handleMessageXp(message) {
    if (!message.guild || message.author.bot) return;
    const guildId = message.guild.id;
    ensureGuildDefaults(guildId);

    if (isIgnoredChannel(guildId, message.channelId)) return;

    const cooldownSec = Number(getConfig(guildId, "xp_message_cooldown_sec") || 15);
    const base = Number(getConfig(guildId, "xp_message_base") || 15);
    const bonusMax = Number(getConfig(guildId, "xp_message_len_bonus_max") || 10);

    const user = ensureUser(guildId, message.author.id);
    const now = nowMs();
    if (user.ultimo_msg && now - Number(user.ultimo_msg) < cooldownSec * 1000) return;

    const len = Math.min(200, effectiveMessageLength(message.content));
    const bonus = Math.floor((len / 200) * bonusMax);
    const gain = Math.max(1, base + bonus);

    db.prepare(`UPDATE xp_users SET ultimo_msg = ? WHERE guildId = ? AND userId = ?`).run(now, guildId, message.author.id);

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    await addXp(message.guild, member || { id: message.author.id }, gain);
    await achievements.applyEvent(message.guild, message.author.id, "message_count", 1);
}

function handleVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const guildId = guild.id;
    ensureGuildDefaults(guildId);

    const userId = newState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const oldEligible = isVoiceXpEligible(oldState);
    const newEligible = isVoiceXpEligible(newState);

    ensureUser(guildId, userId);

    if (!oldEligible && newEligible) {
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(nowMs(), guildId, userId);
        return;
    }

    if (oldEligible && !newEligible) {
        flushVoiceSeconds(guildId, userId);
        db.prepare(`UPDATE xp_users SET voz_inicio = NULL WHERE guildId = ? AND userId = ?`).run(guildId, userId);
        log.debug(`Voz: XP en pausa para ${userId} en ${guildId} (${voiceIneligibleReason(newState)})`);
        return;
    }

    if (oldEligible && newEligible && oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        flushVoiceSeconds(guildId, userId);
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(nowMs(), guildId, userId);
    }
}

function flushVoiceSeconds(guildId, userId) {
    const row = ensureUser(guildId, userId);
    if (!row.voz_inicio) return 0;
    const secs = Math.max(0, Math.floor((nowMs() - Number(row.voz_inicio)) / 1000));
    if (secs > 0) {
        db.prepare(`UPDATE xp_users SET voz_segundos = voz_segundos + ? WHERE guildId = ? AND userId = ?`).run(secs, guildId, userId);
    }
    return secs;
}

async function voiceTick(client) {
    const rows = db.prepare(`SELECT guildId, userId, voz_inicio FROM xp_users WHERE voz_inicio IS NOT NULL`).all();
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        const member = guild.members.cache.get(row.userId) || (await guild.members.fetch(row.userId).catch(() => null));
        if (!member || !member.voice?.channelId) {
            db.prepare(`UPDATE xp_users SET voz_inicio = NULL WHERE guildId = ? AND userId = ?`).run(row.guildId, row.userId);
            continue;
        }
        if (isIgnoredChannel(row.guildId, member.voice.channelId)) continue;
        if (!isVoiceXpEligible(member.voice)) {
            db.prepare(`UPDATE xp_users SET voz_inicio = NULL WHERE guildId = ? AND userId = ?`).run(row.guildId, row.userId);
            log.debug(`Voz: XP en pausa para ${row.userId} en ${row.guildId} (${voiceIneligibleReason(member.voice)})`);
            continue;
        }

        const gainedSecs = flushVoiceSeconds(row.guildId, row.userId);
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(nowMs(), row.guildId, row.userId);

        const perMin = Number(getConfig(row.guildId, "xp_voice_per_min") || 5);
        const xpGain = Math.floor((gainedSecs / 60) * perMin);
        if (xpGain > 0) {
            await addXp(guild, member, xpGain);
            await achievements.applyEvent(guild, member.id, "voice_minutes", gainedSecs / 60);
        }
    }
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

function getRewards(guildId) {
    return db
        .prepare(`SELECT nivel, roleId, roleName, descripcion, emoji FROM xp_role_rewards WHERE guildId = ? ORDER BY nivel ASC`)
        .all(guildId);
}

// Qué desbloquea un rol de recompensa (se muestra en /nivel). Vacío = rol de rango, sin descripción.
function setRewardDescription(guildId, nivel, roleId, descripcion, emoji) {
    const r = db
        .prepare(`UPDATE xp_role_rewards SET descripcion = ?, emoji = ? WHERE guildId = ? AND nivel = ? AND roleId = ?`)
        .run(descripcion || null, emoji || null, guildId, nivel, roleId);
    return r.changes > 0;
}

function setReward(guildId, nivel, roleId, roleName) {
    db.prepare(
        `
        INSERT INTO xp_role_rewards (guildId, nivel, roleId, roleName)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guildId, nivel, roleId) DO UPDATE SET roleName = excluded.roleName
    `,
    ).run(guildId, nivel, roleId, roleName || null);
}

function removeReward(guildId, nivel, roleId = null) {
    if (roleId) {
        db.prepare(`DELETE FROM xp_role_rewards WHERE guildId = ? AND nivel = ? AND roleId = ?`).run(guildId, nivel, roleId);
    } else {
        db.prepare(`DELETE FROM xp_role_rewards WHERE guildId = ? AND nivel = ?`).run(guildId, nivel);
    }
}

function getIgnoredChannels(guildId) {
    return db.prepare(`SELECT channelId, channelName FROM xp_ignored_channels WHERE guildId = ? ORDER BY channelName ASC`).all(guildId);
}

function addIgnoredChannel(guildId, channelId, channelName) {
    db.prepare(
        `
        INSERT INTO xp_ignored_channels (guildId, channelId, channelName)
        VALUES (?, ?, ?)
        ON CONFLICT(guildId, channelId) DO UPDATE SET channelName = excluded.channelName
    `,
    ).run(guildId, channelId, channelName || null);
}

function removeIgnoredChannel(guildId, channelId) {
    db.prepare(`DELETE FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?`).run(guildId, channelId);
}

function clearIgnoredChannels(guildId) {
    db.prepare(`DELETE FROM xp_ignored_channels WHERE guildId = ?`).run(guildId);
}

function getTitles(guildId) {
    ensureGuildDefaults(guildId);
    return db.prepare(`SELECT nivel, title, emoji FROM xp_level_titles WHERE guildId = ? ORDER BY nivel ASC`).all(guildId);
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

async function backfillRoles(guild) {
    if (!guild) return;
    const guildId = guild.id;
    ensureGuildDefaults(guildId);

    // Fetch all members to populate cache
    await guild.members.fetch().catch((e) => log.warn(`Backfill: no se pudo cargar la lista de miembros de ${guild.name}: ${e.message}`));

    const users = db.prepare(`SELECT userId, nivel FROM xp_users WHERE guildId = ? AND nivel > 0`).all(guildId);
    const allRewards = db.prepare(`SELECT nivel, roleId FROM xp_role_rewards WHERE guildId = ? ORDER BY nivel ASC`).all(guildId);

    let assigned = 0;
    const fallos = new Map(); // nombre del rol -> nº de fallos (se resume en una sola línea)
    for (const user of users) {
        const member = guild.members.cache.get(user.userId);
        if (!member) continue;
        const due = allRewards.filter((r) => r.nivel <= user.nivel);
        for (const reward of due) {
            const role = guild.roles.cache.get(reward.roleId);
            if (!role) continue;
            if (member.roles.cache.has(role.id)) continue;
            try {
                await member.roles.add(role);
                assigned++;
            } catch (e) {
                const k = `${role.name}: ${e.message}`;
                fallos.set(k, (fallos.get(k) || 0) + 1);
            }
        }
    }
    for (const [k, n] of fallos) log.warn(`Backfill en ${guild.name}: no se pudo asignar ${k} (${n} miembros)`);
    return assigned;
}

module.exports = {
    ensureGuildDefaults,
    getConfig,
    getAllConfig,
    setConfig,
    xpForNextLevel,
    getUserCostMultiplier,
    setUserCostMultiplier,
    removeUserCostMultiplier,
    titleForLevel,
    nextTitle,
    handleMessageXp,
    handleVoiceStateUpdate,
    voiceTick,
    getProfile,
    getTop,
    getLevelHistory,
    getRewards,
    addXp,
    setRewardDescription,
    setReward,
    removeReward,
    getIgnoredChannels,
    addIgnoredChannel,
    removeIgnoredChannel,
    clearIgnoredChannels,
    getTitles,
    adjustUserXp,
    resetUser,
    backfillRoles,
    runStreakWarningJob,
    getEffectiveStreak,
    streakBonusPct,
};
