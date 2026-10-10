// Pestaña 🏆 Rankings: nivel, riqueza, casino, logros, TTCL, Plex y apuestas en una pantalla.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const xp = require("../../systems/xpSystem");
const achievements = require("../../systems/achievementsSystem");
const plexRankings = require("../../systems/plexRankings");
const rankingApuestas = require("../../systems/apuestas/ranking");
const { duracion } = require("../../systems/plexRankingSemanal");
const { filaPestanasPerfil } = require("../pestanasPerfil");
const { MEDALLAS } = require("./basicos");
const { buildTopEmbed } = require("./embeds");

const RANKINGS = {
    nivel: "📈 Nivel",
    riqueza: "💰 Riqueza",
    casino: "🎰 Casino",
    logros: "🏅 Logros",
    ttcl: "💎 TTCL",
    plex: "🍿 Plex",
    apuestas: "⚽ Apostadores",
};

/** ⚽ Apostadores (F-AP-03): beneficio en apuestas, % de acierto en partidos y mejor racha de partidos ganados seguidos. */
function embedRankingApuestas() {
    const signo = (n) => `${n >= 0 ? "+" : ""}${n.toLocaleString("es")}`;
    const lineas = rankingApuestas.ranking().map((c, i) => {
        const acierto =
            c.acierto === null ? "sin partidos" : `${c.acierto.toLocaleString("es", { maximumFractionDigits: 1 })} % de acierto`;
        const racha = c.racha >= 2 ? ` · 🔥 ${c.racha} seguidas` : "";
        return `${MEDALLAS[i] || `**${i + 1}.**`} <@${c.userId}> — **${signo(c.beneficio)}** 🪙 · ${acierto}${racha}`;
    });
    return new EmbedBuilder()
        .setTitle("⚽ Ranking de apostadores")
        .setDescription(lineas.join("\n") || `Nadie tiene todavía ${rankingApuestas.MIN_RESUELTAS} apuestas resueltas.`)
        .setFooter({
            text: `Beneficio de partidos y quinielas resueltos · acierto y racha, de los partidos · mín. ${rankingApuestas.MIN_RESUELTAS} apuestas resueltas`,
        })
        .setColor(0x3498db);
}

/** 🍿 Rankings de Plex: más logros, más 🎰 Gordos, más políglota y más horas (este mes y de siempre). */
function embedRankingPlex(guildId) {
    const embed = new EmbedBuilder().setTitle("🍿 Rankings de Plex").setColor(0xe5a00d);
    const r = plexRankings.rankings(guildId);
    if (!r) return embed.setDescription("Nadie tiene la cuenta de Plex vinculada todavía.");
    const lista = (l, formato) =>
        l.map((x, i) => `${MEDALLAS[i]} <@${x.discordUserId}> — **${formato(x.n)}**`).join("\n") || "Nadie todavía.";
    const numero = (n) => n.toLocaleString("es");
    return embed
        .addFields(
            { name: "🏆 Más logros de Plex", value: lista(r.logros, numero), inline: true },
            { name: "🎰 Más Gordos del Plex", value: lista(r.gordos, numero), inline: true },
            { name: "🗣️ Más políglota", value: lista(r.poliglota, (n) => `${numero(n)} de idioma`), inline: true },
            { name: `⏱️ Más horas en ${r.mes}`, value: lista(r.horasMes, duracion), inline: true },
            { name: "⏱️ Más horas de siempre", value: lista(r.horasSiempre, duracion), inline: true },
        )
        .setFooter({ text: "Solo quien tiene Plex vinculado. Quien oculta sus logros de Plex no sale en los de logros." });
}

/** El embed de los rankings que no van con páginas (todos menos el de nivel), o null si el tipo es el de nivel. */
function embedRankingFijo(guild, tipo) {
    if (tipo === "riqueza") {
        const { lineasRicos } = require("../economia");
        return new EmbedBuilder()
            .setTitle("💰 Los más ricos")
            .setDescription(lineasRicos(10).join("\n") || "No hay datos todavía.")
            .setFooter({ text: "Efectivo + banco" })
            .setColor(0xf1c40f);
    }
    if (tipo === "casino") return require("../casino").buildRanking().embeds[0];
    if (tipo === "logros") {
        const top = achievements.getTopUsers(guild.id, 10);
        return new EmbedBuilder()
            .setTitle("🏅 Top logros")
            .setDescription(
                top.map((u, i) => `${i + 1}. <@${u.userId}> — **${u.completed}** completados (${u.claimed} reclamados)`).join("\n") ||
                    "Sin datos todavía.",
            )
            .setColor(0xf39c12);
    }
    if (tipo === "ttcl") {
        const top = require("../../systems/cripto/mercado").topTenedoresTtcl(10);
        return new EmbedBuilder()
            .setTitle("📈 Quién tiene más $TTCL")
            .setDescription(
                top.map((t, i) => `${i + 1}. <@${t.userId}> — **${t.cantidad.toFixed(2)}** TTCL`).join("\n") ||
                    "Nadie tiene $TTCL todavía.",
            )
            .setColor(0x9b59b6);
    }
    if (tipo === "plex") return embedRankingPlex(guild.id);
    if (tipo === "apuestas") return embedRankingApuestas();
    return null;
}

/** 🏆 Rankings: uno a la vez, elegido en el menú (el de nivel, con páginas). */
async function buildRankings(guild, ownerId, targetId, tipo = "nivel", page = 0) {
    const fijo = embedRankingFijo(guild, tipo);
    const embed = fijo || (await buildTopEmbed(guild, page));
    const paginas = fijo ? null : { anterior: page > 0, siguiente: xp.getTop(guild.id, 10, (page + 1) * 10).length > 0 };
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

module.exports = { RANKINGS, embedRankingApuestas, embedRankingPlex, buildRankings };
