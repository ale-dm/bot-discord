// Roles de recompensa por nivel (darlos al subir, rellenar los que falten al arrancar y su
// configuración) y el anuncio de subida de nivel.
const db = require("../../core/db");
const { EmbedBuilder } = require("discord.js");
const { createLogger } = require("../../core/logger");
const { ensureGuildDefaults, getConfig, titleForLevel, nextTitle, xpForNextLevel } = require("./config");

const log = createLogger("XP");

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

function getRewards(guildId) {
    return db
        .prepare(`SELECT nivel, roleId, roleName, descripcion, emoji FROM xp_role_rewards WHERE guildId = ? ORDER BY nivel ASC`)
        .all(guildId);
}

// Qué desbloquea un rol de recompensa (se muestra en /perfil). Vacío = rol de rango, sin descripción.
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

module.exports = { tryAssignRewards, maybeAnnounceLevelUp, getRewards, setRewardDescription, setReward, removeReward, backfillRoles };
