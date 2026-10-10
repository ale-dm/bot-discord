// El listado de partidos de ⚽ Apuestas: el selector de partido, la paginación, las competiciones y las pestañas.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { DEPORTES } = require("../../services/oddsApi");
const { PARTIDOS_POR_PAGINA } = require("../../systems/apuestas/apostar");
const { trozos } = require("../../paneles/filas");
const { filaPestanas } = require("../../paneles/pestanasJuegos");

// Las filas del listado: el selector de partido, la paginación, las competiciones (la actual resaltada, con su
// quiniela y la liga y la combinada; cada fila admite 5 botones) y las pestañas.
function componentesListado({ interaction, deporteSeleccionado, partidos, page, offset, totalPartidos }) {
    // Prepara el select menu para elegir partido (máximo 25 opciones por Discord)
    const options = partidos.map((p) => ({
        label: `🏠 ${p.home_team} vs 🚩 ${p.away_team}`,
        description: `🗓️ ${new Date(p.start_time).toLocaleString("es-ES")} | Cuotas: ${p.cuota_home} / ${p.cuota_draw} / ${p.cuota_away}`,
        value: p.match_id,
    }));

    const select = new StringSelectMenuBuilder()
        .setCustomId("apuestas_select_partido")
        .setPlaceholder("Elige un partido para apostar")
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    // Botones de paginación
    const rowBtns = new ActionRowBuilder();
    if (page > 1)
        rowBtns.addComponents(
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page - 1}`)
                .setLabel("⬅️ Anterior")
                .setStyle(ButtonStyle.Secondary),
        );
    if (offset + PARTIDOS_POR_PAGINA < totalPartidos)
        rowBtns.addComponents(
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${deporteSeleccionado}_${page + 1}`)
                .setLabel("Siguiente ➡️")
                .setStyle(ButtonStyle.Secondary),
        );

    // Competiciones (la actual resaltada), la quiniela de esa competición y la liga. Cada fila admite 5 botones,
    // así que con más competiciones salen en varias filas.
    const botonesCompeticion = [
        ...Object.entries(DEPORTES).map(([key, d]) =>
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${key}_1`)
                .setLabel(`${d.emoji} ${d.name}`.slice(0, 80))
                .setStyle(key === deporteSeleccionado ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ButtonBuilder().setCustomId(`quiniela_refrescar_${deporteSeleccionado}`).setLabel("🧾 Quiniela").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("liga_ver").setLabel("🏅 Liga").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("combinada_abrir").setLabel("🧩 Combinada").setStyle(ButtonStyle.Secondary),
    ];
    const filasCompeticion = trozos(botonesCompeticion).map((grupo) => new ActionRowBuilder().addComponents(...grupo));

    return [row, ...(rowBtns.components.length > 0 ? [rowBtns] : []), ...filasCompeticion, filaPestanas(interaction.user.id, "apuestas")];
}

module.exports = { componentesListado };
