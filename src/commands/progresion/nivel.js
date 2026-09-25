const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const xp = require("../../systems/xpSystem");
const achievements = require("../../systems/achievementsSystem");
const casino = require("../../systems/casinoTransactions");
const cripto = require("../../systems/cripto/mercado");
const { createLogger } = require("../../core/logger");

const log = createLogger("Nivel");
const db = require("../../core/db");

function colorByLevel(level) {
    if (level >= 60) return 0x8e44ad;
    if (level >= 40) return 0x2980b9;
    if (level >= 25) return 0xf1c40f;
    if (level >= 10) return 0x2ecc71;
    return 0x4a90e2;
}

function progressBar(current, needed, size = 14) {
    const ratio = needed > 0 ? Math.max(0, Math.min(1, current / needed)) : 0;
    const filled = Math.round(ratio * size);
    return "█".repeat(filled) + "░".repeat(Math.max(0, size - filled));
}

async function buildProfileEmbed(guild, userId) {
    const profile = xp.getProfile(guild.id, userId);
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    const username = member?.user?.username || member?.user?.tag || `<@${userId}>`;
    const avatarUrl = member?.user?.displayAvatarURL({ size: 256, extension: "png" }) || null;
    const bannerColor = member?.user?.accentColor || null;

    const vozHoras = (profile.voz_segundos || 0) / 3600;
    const rewards = xp.getRewards(guild.id);
    const nextReward = rewards.find((r) => r.nivel > profile.nivel);
    const summary = achievements.getSummary(guild.id, userId);
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
        .setDescription(`\`${progressBar(profile.xp, profile.xp_need)}\` **${profile.xp} / ${profile.xp_need} XP** (${xpPct}%)`)
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

function buildAchievementsEmbed(guild, userId, member) {
    const all = achievements.listUserAchievements(guild.id, userId, { includeHidden: false });
    const completed = all.filter((a) => a.completed);
    const inProgress = all.filter((a) => !a.completed && a.progress > 0).slice(0, 6);
    const summary = achievements.getSummary(guild.id, userId);
    const username = member?.user?.username || `<@${userId}>`;
    const avatarUrl = member?.user?.displayAvatarURL({ size: 128, extension: "png" }) || null;

    const completedLines = completed.length
        ? completed.slice(0, 12).map((a) => `${a.emoji || "🏅"} **${a.name}**${a.description ? ` — *${a.description}*` : ""}`)
        : ["Sin logros completados aún."];

    const embed = new EmbedBuilder()
        .setAuthor({ name: username, iconURL: avatarUrl || undefined })
        .setTitle("🏅 Logros")
        .setDescription(`**${summary.completed}/${summary.total}** completados (${summary.completionPct}%)`)
        .addFields({ name: `✅ Completados (${completed.length})`, value: completedLines.join("\n").slice(0, 1024), inline: false })
        .setColor(0xe67e22)
        .setTimestamp();

    if (inProgress.length) {
        const progressLines = inProgress.map((a) => {
            const pct = a.target > 0 ? Math.min(100, Math.floor((a.progress / a.target) * 100)) : 0;
            const bar = progressBar(a.progress, a.target, 10);
            return `${a.emoji || "▫️"} **${a.name}** \`${bar}\` ${pct}%`;
        });
        embed.addFields({ name: "⏳ En progreso", value: progressLines.join("\n").slice(0, 1024), inline: false });
    }

    if (summary.claimable > 0) {
        embed.addFields({
            name: "🎁 ¡Tienes recompensas!",
            value: `**${summary.claimable}** logro(s) completado(s) sin reclamar. Usa \`/logros\` para obtenerlos.`,
            inline: false,
        });
    }

    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return embed;
}

// Ganado y perdido en el casino, de la tabla `casino` (resultado neto de cada partida). Antes salía de
// todo el historial, así que contaba depósitos, transferencias, compras, cripto... como casino.
function resumenCasino(userId) {
    return db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0) AS ganado,
                    COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0) AS perdido
             FROM casino WHERE userId = ?`,
        )
        .get(userId);
}

async function buildEconomyEmbed(guild, userId, member) {
    const saldo = casino.obtenerSaldo(userId);
    const username = member?.user?.username || `<@${userId}>`;
    const avatarUrl = member?.user?.displayAvatarURL({ size: 128, extension: "png" }) || null;
    const { ganado, perdido } = resumenCasino(userId);

    // Todas las criptos valoradas (antes solo TTCL: el resto salía sin valor y fuera del total).
    let cartera = { lineas: [], total: 0 };
    try {
        cartera = await cripto.valorarCartera(userId, guild.id);
    } catch (e) {
        log.warn(`No se pudo valorar la cartera cripto de ${userId}: ${e.message}`);
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: username, iconURL: avatarUrl || undefined })
        .setTitle("💰 Economía")
        .addFields(
            { name: "🏦 Saldo en banco", value: `🪙 **${saldo.toLocaleString()}** coins`, inline: true },
            { name: "📈 Ganado en casino", value: `+${ganado.toLocaleString()}`, inline: true },
            { name: "📉 Perdido en casino", value: `-${perdido.toLocaleString()}`, inline: true },
        )
        .setColor(0x2ecc71)
        .setTimestamp();

    if (cartera.lineas.length) {
        const lineas = cartera.lineas.map(
            (l) =>
                `${l.info?.emoji || "💰"} **${cripto.formatCryptoAmt(l.cantidad)} ${l.cripto}** ≈ ${Math.floor(l.valor).toLocaleString()} coins`,
        );
        const total = `\nTotal ≈ **${Math.floor(cartera.total).toLocaleString()}** coins`;
        embed.addFields({ name: "💹 Cartera cripto", value: lineas.join("\n") + total, inline: false });
    }

    if (avatarUrl) embed.setThumbnail(avatarUrl);
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

function navRow(ownerId, profileUserId, topPage = 0) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nivel_profile_${ownerId}_${profileUserId}`).setLabel("👤 Perfil").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`nivel_top_${ownerId}_${topPage}`).setLabel("🏆 Top").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`nivel_logros_${ownerId}_${profileUserId}`).setLabel("🏅 Logros").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`nivel_eco_${ownerId}_${profileUserId}`).setLabel("💰 Economía").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`nivel_rewards_${ownerId}`).setLabel("🎭 Recompensas").setStyle(ButtonStyle.Secondary),
    );
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["nivel_"], method: "handleButton" }],
    buildProfileEmbed,
    buildTopEmbed,
    buildAchievementsEmbed,
    buildEconomyEmbed,
    buildRewardsEmbed,
    data: new SlashCommandBuilder()
        .setName("nivel")
        .setDescription("Ver nivel y perfil avanzado")
        .addUserOption((o) => o.setName("usuario").setDescription("Usuario objetivo (opcional)").setRequired(false)),

    async run(client, interaction) {
        const guild = interaction.guild;
        const ownerId = interaction.user.id;

        if (!guild) {
            await interaction.reply({ content: "Este comando solo funciona en servidores.", flags: MessageFlags.Ephemeral });
            return;
        }

        xp.ensureGuildDefaults(guild.id);
        const target = interaction.options.getUser("usuario") || interaction.user;
        const embed = await buildProfileEmbed(guild, target.id);
        await interaction.reply({ embeds: [embed], components: [navRow(ownerId, target.id, 0)] });
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (!id.startsWith("nivel_")) return;

        const guild = interaction.guild;
        const userId = interaction.user.id;
        if (!guild) {
            await interaction.reply({ content: "Solo disponible en servidores.", flags: MessageFlags.Ephemeral });
            return;
        }

        const idParts = id.split("_");
        // nivel_top_prev_/next_ tienen un segmento extra antes del ownerId
        const ownerId = id.startsWith("nivel_top_prev_") || id.startsWith("nivel_top_next_") ? idParts[3] : idParts[2];
        if (ownerId && ownerId !== userId) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (id.startsWith("nivel_profile_")) {
            const targetId = id.split("_")[3] || userId;
            const embed = await buildProfileEmbed(guild, targetId);
            await interaction.update({ embeds: [embed], components: [navRow(ownerId, targetId, 0)] });
            return;
        }

        if (id.startsWith("nivel_rewards_")) {
            const embed = buildRewardsEmbed(guild);
            await interaction.update({ embeds: [embed], components: [navRow(ownerId, userId, 0)] });
            return;
        }

        if (id.startsWith("nivel_logros_")) {
            const targetId = id.split("_")[3] || userId;
            const member = guild.members.cache.get(targetId) || (await guild.members.fetch(targetId).catch(() => null));
            const embed = buildAchievementsEmbed(guild, targetId, member);
            await interaction.update({ embeds: [embed], components: [navRow(ownerId, targetId, 0)] });
            return;
        }

        if (id.startsWith("nivel_eco_")) {
            const targetId = id.split("_")[3] || userId;
            const member = guild.members.cache.get(targetId) || (await guild.members.fetch(targetId).catch(() => null));
            const embed = await buildEconomyEmbed(guild, targetId, member);
            await interaction.update({ embeds: [embed], components: [navRow(ownerId, targetId, 0)] });
            return;
        }

        if (id.startsWith("nivel_top_prev_") || id.startsWith("nivel_top_next_") || id.startsWith("nivel_top_")) {
            let page = 0;
            if (id.startsWith("nivel_top_prev_") || id.startsWith("nivel_top_next_")) {
                const p = parseInt(id.split("_")[4] || "0", 10);
                const isNext = id.startsWith("nivel_top_next_");
                page = Math.max(0, p + (isNext ? 1 : -1));
            } else {
                page = parseInt(id.split("_")[3] || "0", 10);
            }

            const embed = await buildTopEmbed(guild, page);
            const rows = xp.getTop(guild.id, 10, page * 10);
            const canPrev = page > 0;
            const canNext = rows.length === 10;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`nivel_profile_${ownerId}_${userId}`).setLabel("👤 Perfil").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`nivel_top_prev_${ownerId}_${page}`)
                    .setLabel("⏮️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!canPrev),
                new ButtonBuilder()
                    .setCustomId(`nivel_top_next_${ownerId}_${page}`)
                    .setLabel("⏭️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!canNext),
                new ButtonBuilder().setCustomId(`nivel_logros_${ownerId}_${userId}`).setLabel("🏅 Logros").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`nivel_eco_${ownerId}_${userId}`).setLabel("💰 Economía").setStyle(ButtonStyle.Secondary),
            );
            await interaction.update({ embeds: [embed], components: [row] });
        }
    },
};
