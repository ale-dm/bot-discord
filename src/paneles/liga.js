// 🏅 Liga de pronósticos (F-AP-12, #8): la clasificación de la temporada actual, tu posición y los campeones anteriores.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const liga = require("../systems/apuestas/liga");
const { DEPORTES } = require("../services/oddsApi");
const { fmtNumero } = require("../core/formato");

const TOP = 10;
const GENERAL = "general";

/** El menú para ver la liga de una competición (#380) o la general. `actual`: la competición que se está viendo (o null = general). */
function filaCompeticion(actual) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId("liga_competicion")
        .setPlaceholder("Competición")
        .addOptions([
            { label: "🌍 General (todas las competiciones)", value: GENERAL, default: !actual },
            ...Object.entries(DEPORTES).map(([clave, d]) => ({ label: d.name.slice(0, 100), value: clave, default: clave === actual })),
        ]);
    return new ActionRowBuilder().addComponents(menu);
}

/** Los campos de la clasificación y de tu posición (de la competición, o de la general). */
function camposClasificacion(todos, pos, competicion) {
    const lineas = todos
        .slice(0, TOP)
        .map(
            (r, i) =>
                `${i + 1}. <@${r.userId}> · **${r.puntos}** ${r.puntos === 1 ? "punto" : "puntos"} · ${r.quinielas} ${r.quinielas === 1 ? "quiniela" : "quinielas"}`,
        );
    const vacia = competicion
        ? "Nadie ha sumado puntos en esta competición todavía."
        : "Nadie ha sumado puntos todavía. Juega una quiniela.";
    return [
        { name: "📊 Clasificación", value: lineas.length ? lineas.join("\n") : vacia, inline: false },
        {
            name: "📍 Tu posición",
            value:
                pos >= 0 ? `${pos + 1}.º con **${fmtNumero(todos[pos].puntos)}** puntos` : "Todavía no has sumado puntos esta temporada.",
            inline: false,
        },
    ];
}

/** Los campeones de las últimas temporadas (solo en la general). */
function campoAnteriores(anteriores) {
    const lineas = anteriores.map((t) =>
        t.campeones[0]
            ? `**${t.temporada}** · 🥇 <@${t.campeones[0].userId}> (${t.campeones[0].puntos} pts)`
            : `**${t.temporada}** · sin puntos`,
    );
    return { name: "🏆 Temporadas anteriores", value: lineas.length ? lineas.join("\n") : "Ninguna todavía.", inline: false };
}

/**
 * La pantalla de la liga (la temporada de ahora). Con `deporte` (#380), la clasificación de esa competición; la general (con la
 * posición, los premios y los campeones de siempre) no cambia. Vuelve a ⚽ Apuestas con un botón.
 */
function pantallaLiga(guildId, viewerId, ahora = Date.now(), deporte = null) {
    const competicion = deporte && DEPORTES[deporte] ? deporte : null;
    const temporada = liga.temporadaDe(ahora);
    const premios = liga.premiosDe(guildId);
    const todos = liga.clasificacion(temporada, 1000, competicion);
    const pos = todos.findIndex((r) => String(r.userId) === String(viewerId));

    const descripcion = competicion
        ? `Los puntos de las quinielas de **${DEPORTES[competicion].name}** (1 por acierto). Es solo informativo: los premios de fin de ` +
          "temporada se reparten con la clasificación **general**."
        : `Cada acierto en una quiniela suma **1 punto**. La temporada va de julio a junio. ` +
          `Al acabar se paga al efectivo a los tres primeros: ${premios.map((p) => `**${fmtNumero(p)}** 🪙`).join(" · ")}.`;
    const embed = new EmbedBuilder()
        .setTitle(`🏅 Liga de pronósticos · ${temporada}${competicion ? ` · ${DEPORTES[competicion].name}` : ""}`)
        .setDescription(descripcion)
        .addFields(camposClasificacion(todos, pos, competicion))
        .setColor(0xf1c40f)
        .setFooter({ text: "Cuentan las quinielas cerradas durante la temporada." });
    if (!competicion) embed.addFields(campoAnteriores(liga.campeonesAnteriores(guildId, 3)));

    const volver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("apuestas_pagina_laliga_1").setLabel("⚽ Volver a apuestas").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [filaCompeticion(competicion), volver], files: [], attachments: [] };
}

module.exports = { pantallaLiga };
