// 🏅 Liga de pronósticos (F-AP-12, #8): la clasificación de la temporada actual, tu posición y los campeones anteriores.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const liga = require("../systems/apuestas/liga");
const { fmtNumero } = require("../core/formato");

const TOP = 10;

/** La pantalla de la liga (la temporada de ahora). Vuelve a ⚽ Apuestas con un botón. */
function pantallaLiga(guildId, viewerId, ahora = Date.now()) {
    const temporada = liga.temporadaDe(ahora);
    const premios = liga.premiosDe(guildId);
    const todos = liga.clasificacion(temporada, 1000);
    const pos = todos.findIndex((r) => String(r.userId) === String(viewerId));
    const anteriores = liga.campeonesAnteriores(guildId, 3);

    const embed = new EmbedBuilder()
        .setTitle(`🏅 Liga de pronósticos · ${temporada}`)
        .setDescription(
            `Cada acierto en una quiniela suma **1 punto**. La temporada va de julio a junio. ` +
                `Al acabar se paga al efectivo a los tres primeros: ${premios.map((p) => `**${fmtNumero(p)}** 🪙`).join(" · ")}.`,
        )
        .addFields(
            {
                name: "📊 Clasificación",
                value: todos.length
                    ? todos
                          .slice(0, TOP)
                          .map(
                              (r, i) =>
                                  `${i + 1}. <@${r.userId}> · **${r.puntos}** ${r.puntos === 1 ? "punto" : "puntos"} · ${r.quinielas} ${r.quinielas === 1 ? "quiniela" : "quinielas"}`,
                          )
                          .join("\n")
                    : "Nadie ha sumado puntos todavía. Juega una quiniela.",
                inline: false,
            },
            {
                name: "📍 Tu posición",
                value:
                    pos >= 0
                        ? `${pos + 1}.º con **${fmtNumero(todos[pos].puntos)}** puntos`
                        : "Todavía no has sumado puntos esta temporada.",
                inline: false,
            },
            {
                name: "🏆 Temporadas anteriores",
                value: anteriores.length
                    ? anteriores
                          .map((t) =>
                              t.campeones[0]
                                  ? `**${t.temporada}** · 🥇 <@${t.campeones[0].userId}> (${t.campeones[0].puntos} pts)`
                                  : `**${t.temporada}** · sin puntos`,
                          )
                          .join("\n")
                    : "Ninguna todavía.",
                inline: false,
            },
        )
        .setColor(0xf1c40f)
        .setFooter({ text: "Cuentan las quinielas cerradas durante la temporada." });

    const volver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("apuestas_pagina_laliga_1").setLabel("⚽ Volver a apuestas").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [volver], files: [], attachments: [] };
}

module.exports = { pantallaLiga };
