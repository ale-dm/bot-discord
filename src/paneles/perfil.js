// Pantallas de /perfil: 👤 Perfil (ficha de nivel, racha, dinero y próxima recompensa), 🏅 Logros (con páginas,
// secretos y reclamar), 🏆 Rankings (nivel, riqueza, casino, logros y TTCL en una pantalla) y 🎭 Recompensas de
// nivel. La pestaña 💰 Economía está en paneles/economia. Antes eran /nivel y /logros.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const xp = require("../systems/xpSystem");
const achievements = require("../systems/achievementsSystem");
const dinero = require("../systems/dinero");
const plexLinks = require("../systems/plexLinks");
const plexTrofeos = require("../systems/plexTrofeos");
const { filaPestanasPerfil } = require("./pestanasPerfil");

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

function barraLogro(progress, target) {
    const ratio = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0;
    const filled = Math.round(ratio * 10);
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.floor(ratio * 100)}%`;
}

function buildLogros(guildId, ownerId, targetId, page = 0, includeHidden = false) {
    const userId = targetId;
    const propio = ownerId === targetId;
    // Quien oculta sus logros de Plex (lo que ve) no los enseña en su perfil a los demás.
    const plexOculto = plexTrofeos.oculto(guildId, userId);
    const opciones = !propio && plexOculto ? { excluirCategorias: ["plex"] } : {};
    const list = achievements.listUserAchievements(guildId, userId, { ...opciones, includeHidden });
    const summary = achievements.getSummary(guildId, userId, opciones);
    const rarezas = list.some((a) => a.category === "plex") ? plexTrofeos.rarezas(guildId) : new Map();

    const pageSize = 6;
    const maxPage = Math.max(0, Math.ceil(list.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const slice = list.slice(start, start + pageSize);

    const desc = slice.length
        ? slice
              .map((a) => {
                  if (a.hidden && !a.completed && !includeHidden) return "❓ **Logro secreto**";
                  const status = a.completed ? (a.claimable ? "🎁" : "✅") : "⏳";
                  const p = Math.min(a.progress, a.target);
                  const rareza = a.category === "plex" && a.completed ? ` · 🏆 ${plexTrofeos.textoRareza(rarezas.get(a.id))}` : "";
                  return `${status} **${a.name}** (${a.category})\n${a.desc}\n${barraLogro(p, a.target)}${rareza}\n`;
              })
              .join("\n")
        : "No hay logros en esta vista.";

    const embed = new EmbedBuilder()
        .setTitle(propio ? "🏅 Tus logros" : "🏅 Logros")
        .setDescription(desc)
        .addFields(
            { name: "Completados", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "Pendientes de reclamar", value: String(summary.claimable), inline: true },
            { name: "Página", value: `${safePage + 1}/${maxPage + 1}`, inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage - 1}_${includeHidden ? 1 : 0}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage + 1}_${includeHidden ? 1 : 0}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_0_${includeHidden ? 0 : 1}`)
            .setLabel(includeHidden ? "🙈 Ocultar secretos" : "👁️ Ver secretos")
            .setStyle(ButtonStyle.Secondary),
    );
    if (propio && summary.claimable > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`perfil_reclamartodo_${ownerId}_${targetId}`)
                .setLabel("🎁 Reclamar todo")
                .setStyle(ButtonStyle.Success),
        );
    }
    // Solo a quien tiene la cuenta de Plex vinculada: que sus logros de Plex no se anuncien ni los vean los demás.
    if (propio && plexLinks.getLinkByDiscordId(guildId, userId)) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`perfil_plexoculto_${ownerId}_${targetId}_${plexOculto ? 0 : 1}`)
                .setLabel(plexOculto ? "🍿 Enseñar mis logros de Plex" : "🍿 Ocultar mis logros de Plex")
                .setStyle(ButtonStyle.Secondary),
        );
    }

    const components = [row];
    const menu = propio ? menuReclamar(guildId, ownerId, targetId) : null;
    if (menu) components.push(menu);
    components.push(filaPestanasPerfil(ownerId, targetId, "logros"));
    return { content: "", embeds: [embed], components };
}

function menuReclamar(guildId, ownerId, targetId) {
    const userId = targetId;
    const pendientes = achievements.listUserAchievements(guildId, userId, { includeHidden: true }).filter((a) => a.claimable);
    if (!pendientes.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`perfil_reclamar_${ownerId}_${targetId}`)
            .setPlaceholder(`🎁 Reclamar un logro (${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"})`)
            .addOptions(
                pendientes.slice(0, 25).map((a) => ({
                    label: a.name.slice(0, 100),
                    description: `+${achievements.rewardCoinsFor(a, guildId).toLocaleString("es")} 🪙`,
                    value: a.id,
                    emoji: a.emoji || undefined,
                })),
            ),
    );
}

/** 👤 Perfil: la ficha de nivel con el dinero, y el botón de las recompensas de nivel. */
async function buildPerfil(guild, ownerId, targetId) {
    const embed = await buildProfileEmbed(guild, targetId);
    const c = dinero.cuenta(targetId);
    embed.addFields({
        name: "💰 Dinero",
        value: `💵 ${c.efectivo.toLocaleString("es")} · 🏦 ${c.banco.toLocaleString("es")}`,
        inline: true,
    });
    const extra = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`perfil_recompensas_${ownerId}_${targetId}`)
            .setLabel("🎭 Recompensas de nivel")
            .setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [extra, filaPestanasPerfil(ownerId, targetId, "perfil")] };
}

function buildRecompensas(guild, ownerId, targetId) {
    return { content: "", embeds: [buildRewardsEmbed(guild)], components: [filaPestanasPerfil(ownerId, targetId, "perfil")] };
}

const RANKINGS = {
    nivel: "📈 Nivel",
    riqueza: "💰 Riqueza",
    casino: "🎰 Casino",
    logros: "🏅 Logros",
    ttcl: "💎 TTCL",
};

/** 🏆 Rankings: uno a la vez, elegido en el menú (el de nivel, con páginas). */
async function buildRankings(guild, ownerId, targetId, tipo = "nivel", page = 0) {
    let embed;
    let paginas = null;
    if (tipo === "riqueza") {
        const { lineasRicos } = require("./economia");
        embed = new EmbedBuilder()
            .setTitle("💰 Los más ricos")
            .setDescription(lineasRicos(10).join("\n") || "No hay datos todavía.")
            .setFooter({ text: "Efectivo + banco" })
            .setColor(0xf1c40f);
    } else if (tipo === "casino") {
        embed = require("./casino").buildRanking().embeds[0];
    } else if (tipo === "logros") {
        const top = achievements.getTopUsers(guild.id, 10);
        embed = new EmbedBuilder()
            .setTitle("🏅 Top logros")
            .setDescription(
                top.map((u, i) => `${i + 1}. <@${u.userId}> — **${u.completed}** completados (${u.claimed} reclamados)`).join("\n") ||
                    "Sin datos todavía.",
            )
            .setColor(0xf39c12);
    } else if (tipo === "ttcl") {
        embed = (await require("./cripto").buildTopHolders(guild.id)).embeds[0];
    } else {
        embed = await buildTopEmbed(guild, page);
        paginas = { anterior: page > 0, siguiente: xp.getTop(guild.id, 10, (page + 1) * 10).length > 0 };
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`perfil_ranksel_${ownerId}_${targetId}`)
        .setPlaceholder("Qué ranking")
        .addOptions(Object.entries(RANKINGS).map(([value, label]) => ({ label, value, default: value === tipo })));
    const components = [new ActionRowBuilder().addComponents(menu)];
    if (paginas) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`perfil_rank_${ownerId}_${targetId}_nivel_${page - 1}`)
                    .setLabel("⏮️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!paginas.anterior),
                new ButtonBuilder()
                    .setCustomId(`perfil_rank_${ownerId}_${targetId}_nivel_${page + 1}`)
                    .setLabel("⏭️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!paginas.siguiente),
            ),
        );
    }
    components.push(filaPestanasPerfil(ownerId, targetId, "rankings"));
    return { content: "", embeds: [embed], components };
}

module.exports = { buildPerfil, buildRecompensas, buildLogros, buildRankings, buildProfileEmbed, RANKINGS };
