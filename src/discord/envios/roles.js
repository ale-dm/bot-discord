// Adaptador de los roles de recompensa por nivel (#472): dar los roles al subir, anunciar la subida y rellenar los que
// falten al arrancar. La configuración y las consultas viven en src/systems/xp/roles.
const { embedSubidaNivel } = require("../mensajes/nivel");
const { createLogger } = require("../../core/logger");
const { ensureGuildDefaults, getConfig, titleForLevel, nextTitle, xpForNextLevel, anunciosOff } = require("../../systems/xp/config");
const roles = require("../../systems/xp/roles");

const log = createLogger("XP");

async function tryAssignRewards(guild, member, oldLevel, newLevel) {
    if (!guild || !member) return;
    for (const reward of roles.recompensasPara(guild.id, oldLevel, newLevel)) {
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
    // #373: quien no quiere que se anuncie su subida (los roles se dan igual, en tryAssignRewards).
    if (anunciosOff(guild.id, member.id)) return;
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

    // Solo un GuildMember de discord.js trae su mención; un objeto plano { id } heredaría [object Object] de Object.
    const mention = member?.user ? member.toString() : `<@${member.id}>`;
    const currentTitle = titleForLevel(guild.id, newLevel);
    const upcomingTitle = nextTitle(guild.id, newLevel);
    const nextNeed = xpForNextLevel(newLevel, guild.id, member.id);
    const rewardRole = roles.recompensaDeNivel(guild.id, newLevel);

    const embed = embedSubidaNivel({ mention, newLevel, currentTitle, upcomingTitle, nextNeed, rewardRole, guildName: guild.name });

    try {
        await channel.send({ embeds: [embed] });
    } catch (e) {
        log.warn(`No se pudo anunciar la subida de nivel de ${member.id} en #${channel.name}:`, e.message);
    }
}

async function backfillRoles(guild) {
    if (!guild) return;
    const guildId = guild.id;
    ensureGuildDefaults(guildId);

    // Fetch all members to populate cache
    await guild.members.fetch().catch((e) => log.warn(`Backfill: no se pudo cargar la lista de miembros de ${guild.name}: ${e.message}`));

    const users = roles.usuariosConNivel(guildId);
    const allRewards = roles.getRewards(guildId);

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

module.exports = { tryAssignRewards, maybeAnnounceLevelUp, backfillRoles };
