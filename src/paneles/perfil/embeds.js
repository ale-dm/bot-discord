// Embeds de perfil: la ficha de nivel de la pestaña 👤, la lista del top y el de recompensas de nivel.

const { EmbedBuilder } = require("discord.js");
const xp = require("../../systems/xpSystem");
const achievements = require("../../systems/achievementsSystem");
const eventos = require("../../systems/eventos");
const { colorByLevel, progressBar } = require("./basicos");

async function buildProfileEmbed(guild, userId, opcionesLogros = {}) {
    const profile = xp.getProfile(guild.id, userId);
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    const username = member?.user?.username || member?.user?.tag || `<@${userId}>`;
    const avatarUrl = member?.user?.displayAvatarURL({ size: 256, extension: "png" }) || null;
    const bannerColor = member?.user?.accentColor || null;

    const vozHoras = (profile.voz_segundos || 0) / 3600;
    const rewards = xp.getRewards(guild.id);
    const nextReward = rewards.find((r) => r.nivel > profile.nivel);
    const summary = achievements.getSummary(guild.id, userId, opcionesLogros);
    const currentTitle = profile.title || { title: "SIN RANGO", emoji: "▫️" };
    const xpPct = profile.xp_need > 0 ? Math.floor((profile.xp / profile.xp_need) * 100) : 0;
    const history = xp.getLevelHistory(guild.id, userId, 4);
    const historyText = history.length
        ? history.map((h) => `LVL ${h.nivel} · <t:${Math.floor(Number(h.createdAt) / 1000)}:R>`).join("\n")
        : "Sin subidas registradas aún";
    const streakText = profile.streak >= 2 ? `🔥 ${profile.streak} días (+${profile.streakBonusPct.toFixed(0)}% XP)` : "Sin racha activa";

    const embed = new EmbedBuilder()
        .setAuthor({ name: username, iconURL: avatarUrl || undefined })
        .setTitle(`${currentTitle.emoji || "▫️"} ${currentTitle.title || "SIN RANGO"} · Nivel ${profile.nivel}`)
        .setDescription(
            `\`${progressBar(profile.xp, profile.xp_need)}\` **${profile.xp} / ${profile.xp_need} XP** (${xpPct}%)` +
                // ⚡ Happy hour de XP en marcha (F-EC-02)
                (eventos.lineaXp(guild.id) ? `\n${eventos.lineaXp(guild.id)}` : ""),
        )
        .addFields(
            { name: "🏆 Ranking", value: `#${profile.rank}`, inline: true },
            { name: "✨ XP total", value: `${profile.xp_total}`, inline: true },
            { name: "🎙️ Voz", value: `${vozHoras.toFixed(1)} h`, inline: true },
            { name: "🏅 Logros", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "🔥 Racha", value: streakText, inline: true },
            {
                name: "🎯 Próxima recompensa",
                value: nextReward
                    ? `LVL ${nextReward.nivel} · <@&${nextReward.roleId}>${nextReward.descripcion ? ` — ${nextReward.descripcion}` : ""}`
                    : "Sin recompensa siguiente",
                inline: false,
            },
            { name: "🕒 Últimos hitos", value: historyText, inline: false },
        )
        .setColor(bannerColor || colorByLevel(profile.nivel))
        .setTimestamp();

    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return embed;
}

async function buildTopEmbed(guild, page = 0) {
    const pageSize = 10;
    const rows = xp.getTop(guild.id, pageSize, page * pageSize);
    const MEDALS = ["🥇", "🥈", "🥉"];

    const lines = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const pos = page * pageSize + i + 1;
        const medal = pos <= 3 ? MEDALS[pos - 1] : `\`${pos}.\``;
        const member = guild.members.cache.get(r.userId) || (await guild.members.fetch(r.userId).catch(() => null));
        const name = member?.user?.username || r.userId;
        const title = xp.titleForLevel(guild.id, r.nivel);
        const rankStr = title?.title ? ` ${title.emoji || ""} ${title.title}` : "";
        lines.push(`${medal} **${name}** · LVL ${r.nivel}${rankStr} — ${r.xp_total.toLocaleString()} XP`);
    }

    const embed = new EmbedBuilder()
        .setTitle("🏆 Clasificación · " + guild.name)
        .setDescription(lines.length ? lines.join("\n") : "Aún no hay datos de nivel.")
        .setColor(0xf1c40f)
        .setFooter({ text: `Página ${page + 1}` })
        .setTimestamp();

    const iconUrl = guild.iconURL({ size: 128, extension: "png" });
    if (iconUrl) embed.setThumbnail(iconUrl);

    return embed;
}

function buildRewardsEmbed(guild) {
    const guildId = guild.id;
    const rewards = xp.getRewards(guildId);

    const rankLines = [];
    const permLines = [];

    for (const r of rewards) {
        // Los roles con descripción son permisos que se desbloquean; el resto, rangos.
        if (r.descripcion) {
            permLines.push(`${r.emoji || "🔓"} **LVL ${r.nivel}** · <@&${r.roleId}> — ${r.descripcion}`);
        } else {
            rankLines.push(`🎖️ **LVL ${r.nivel}** · <@&${r.roleId}>`);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("🎭 Recompensas de niveles")
        .setDescription("Al alcanzar cada nivel el bot te otorga los roles automáticamente.")
        .setColor(0x9b59b6)
        .setTimestamp();

    if (rankLines.length) embed.addFields({ name: "🏅 Roles de rango", value: rankLines.join("\n"), inline: false });
    if (permLines.length) embed.addFields({ name: "🔑 Permisos desbloqueables", value: permLines.join("\n"), inline: false });
    if (!rankLines.length && !permLines.length)
        embed.addFields({ name: "Sin recompensas", value: "No hay roles configurados aún.", inline: false });

    return embed;
}

module.exports = { buildProfileEmbed, buildTopEmbed, buildRewardsEmbed };
