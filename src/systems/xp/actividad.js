// De dónde sale la XP: mensajes (con cooldown y bonus por longitud) y minutos en voz (solo sin
// mute/ensordecer y con alguien más en el canal).
const db = require("../../core/db");
const achievements = require("../achievementsSystem");
const { createLogger } = require("../../core/logger");
const pase = require("../pase/pase");
const {
    ensureGuildDefaults,
    getConfig,
    getConfigMensajes,
    getUltimoMensaje,
    registrarMensaje,
    ensureUser,
    isIgnoredChannel,
    multiplicadorCanal,
    tieneRolIgnorado,
    getUltimaReaccion,
    registrarReaccion,
} = require("./config");
const { addXp } = require("./progreso");

const log = createLogger("XP");

function hasOtherActiveMembers(voiceState) {
    const channel = voiceState?.channel;
    if (!channel) return true; // channel not cached: don't block XP on a cache miss
    const nonBotMembers = channel.members.filter((m) => !m.user?.bot).size;
    return nonBotMembers >= 2;
}

function isVoiceXpEligible(voiceState) {
    if (!voiceState?.channelId) return false;
    if (tieneRolIgnorado(voiceState.guild?.id, voiceState.member)) return false;
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

    // Lo más barato primero (#483): el cooldown se mira con la configuración guardada y una sola lectura, y un mensaje
    // que no cuenta no hace nada más. Solo si cuenta se mira el canal y se escribe, en una transacción.
    const { cooldownSec, base, bonusMax } = getConfigMensajes(guildId);
    const now = Date.now();
    const ultimo = getUltimoMensaje(guildId, message.author.id);
    if (ultimo && now - Number(ultimo) < cooldownSec * 1000) return;

    const multiplicadorDelCanal = multiplicadorCanal(guildId, message.channelId);
    if (isIgnoredChannel(guildId, message.channelId) || multiplicadorDelCanal === 0) return;

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (tieneRolIgnorado(guildId, member)) return;

    const len = Math.min(200, effectiveMessageLength(message.content));
    const bonus = Math.floor((len / 200) * bonusMax);
    const gain = Math.max(1, base + bonus);

    registrarMensaje(guildId, message.author.id, now);

    const autor = member || { id: message.author.id };
    const resultado = await addXp(message.guild, autor, gain, { multiplicadorCanal: multiplicadorDelCanal });
    await achievements.applyEvent(message.guild, message.author.id, "message_count", 1);
    pase.registrarSeguro(guildId, message.author.id, "mensaje");
    return { guild: message.guild, member: autor, resultado };
}

/**
 * Da XP al autor de un mensaje cuando otra persona le reacciona (#358), como mucho una vez cada N segundos por autor.
 * Solo gana el autor. No cuentan: reacciones de bots, a mensajes propios o de bots, en canales ignorados ni de quien
 * tiene un rol sin XP. Con `xp_reaction_base` a 0 está desactivado.
 */
async function handleReactionXp(reaction, user) {
    if (user.bot) return;
    const mensaje = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!mensaje?.guild || !mensaje.author || mensaje.author.bot || mensaje.author.id === user.id) return;
    const guildId = mensaje.guild.id;
    const base = Number(getConfig(guildId, "xp_reaction_base") || 0);
    if (!(base > 0)) return;

    const ahora = Date.now();
    const ultima = getUltimaReaccion(guildId, mensaje.author.id);
    const cooldownSec = Number(getConfig(guildId, "xp_reaction_cooldown_sec") || 0);
    if (ultima && ahora - Number(ultima) < cooldownSec * 1000) return;

    const multiplicadorDelCanal = multiplicadorCanal(guildId, mensaje.channelId);
    if (isIgnoredChannel(guildId, mensaje.channelId) || multiplicadorDelCanal === 0) return;
    const autor = mensaje.member || (await mensaje.guild.members.fetch(mensaje.author.id).catch(() => null));
    if (tieneRolIgnorado(guildId, autor)) return;

    registrarReaccion(guildId, mensaje.author.id, ahora);
    const autorXp = autor || { id: mensaje.author.id };
    const resultado = await addXp(mensaje.guild, autorXp, base, { multiplicadorCanal: multiplicadorDelCanal });
    return { guild: mensaje.guild, member: autorXp, resultado };
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
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(Date.now(), guildId, userId);
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
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(Date.now(), guildId, userId);
    }
}

function flushVoiceSeconds(guildId, userId) {
    const row = ensureUser(guildId, userId);
    if (!row.voz_inicio) return 0;
    const secs = Math.max(0, Math.floor((Date.now() - Number(row.voz_inicio)) / 1000));
    if (secs > 0) {
        db.prepare(`UPDATE xp_users SET voz_segundos = voz_segundos + ? WHERE guildId = ? AND userId = ?`).run(secs, guildId, userId);
    }
    return secs;
}

async function voiceTick(client) {
    const resultados = [];
    const rows = db.prepare(`SELECT guildId, userId, voz_inicio FROM xp_users WHERE voz_inicio IS NOT NULL`).all();
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        const member = guild.members.cache.get(row.userId) || (await guild.members.fetch(row.userId).catch(() => null));
        if (!member || !member.voice?.channelId) {
            db.prepare(`UPDATE xp_users SET voz_inicio = NULL WHERE guildId = ? AND userId = ?`).run(row.guildId, row.userId);
            continue;
        }
        const multiplicadorDelCanal = multiplicadorCanal(row.guildId, member.voice.channelId);
        if (isIgnoredChannel(row.guildId, member.voice.channelId) || multiplicadorDelCanal === 0) continue;
        if (!isVoiceXpEligible(member.voice)) {
            db.prepare(`UPDATE xp_users SET voz_inicio = NULL WHERE guildId = ? AND userId = ?`).run(row.guildId, row.userId);
            log.debug(`Voz: XP en pausa para ${row.userId} en ${row.guildId} (${voiceIneligibleReason(member.voice)})`);
            continue;
        }

        const gainedSecs = flushVoiceSeconds(row.guildId, row.userId);
        const minutos = Math.floor(gainedSecs / 60);
        if (minutos > 0) pase.registrarSeguro(row.guildId, row.userId, "voz", minutos);
        db.prepare(`UPDATE xp_users SET voz_inicio = ? WHERE guildId = ? AND userId = ?`).run(Date.now(), row.guildId, row.userId);

        const perMin = Number(getConfig(row.guildId, "xp_voice_per_min") || 5);
        const xpGain = Math.floor((gainedSecs / 60) * perMin);
        if (xpGain > 0) {
            const resultado = await addXp(guild, member, xpGain, { multiplicadorCanal: multiplicadorDelCanal });
            await achievements.applyEvent(guild, member.id, "voice_minutes", gainedSecs / 60);
            resultados.push({ guild, member, resultado });
        }
    }
    return resultados;
}

module.exports = { handleMessageXp, handleReactionXp, handleVoiceStateUpdate, voiceTick };
