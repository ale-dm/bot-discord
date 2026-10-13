// Lo que se ve de la quiniela: la quiniela de una competición (o el aviso de que no hay, con el botón de crearla para admins).
// Lo usan el comando (quiniela.js) y el botón Refrescar (quiniela/botones.js), así que no dependen uno del otro (#474).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const repo = require("../../../repositorios/apuestas");
const { DEPORTES } = require("../../../services/oddsApi");
const { minimoAciertosQuiniela } = require("../../../systems/apuestas/liquidacion");
const misJugadas = require("../../../systems/apuestas/misJugadas");
const { lineaQuiniela } = require("../../../paneles/misJugadas");
const { filaPestanas } = require("../../../paneles/pestanasJuegos");
const { esAdmin } = require("../../../core/permisos");
const { obtenerPartidosQuiniela } = require("../../../systems/apuestas/quinielas");

// La quiniela sin partido abierto: aviso (y botón de crearla, si es admin) con sus pestañas.
function vistaSinQuiniela(interaction, deporte, deporteSeleccionado, isAdmin) {
    const embed = new EmbedBuilder()
        .setTitle(`🧾 Quiniela ${deporte.name}`)
        .setDescription(
            "No hay quiniela activa para este deporte.\n\n" +
                (isAdmin
                    ? "Como admin, puedes crear una jornada con los próximos 10 partidos."
                    : "Pide a un admin que cree la quiniela de la jornada."),
        )
        .setColor(0x95a5a6);

    const components = [];
    if (isAdmin) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`quiniela_crear_${deporteSeleccionado}`)
                    .setLabel("🛠️ Crear quiniela")
                    .setStyle(ButtonStyle.Primary),
            ),
        );
    }

    components.push(filaPestanas(interaction.user.id, "apuestas"));
    return { embeds: [embed], components };
}

// La quiniela abierta: sus partidos, el bote, tu quiniela si ya has apostado y los botones de apostar.
function vistaQuiniela(interaction, quiniela, deporte, deporteSeleccionado) {
    const partidos = obtenerPartidosQuiniela(quiniela.id);
    const listado = partidos.map((p) => `${p.orden}. ${p.home_team} vs ${p.away_team}`).join("\n");
    const bote = repo.boteQuiniela(quiniela.id);

    // Si ya has apostado, tus pronósticos con ✅/❌ en los partidos jugados (antes solo se decía que ya
    // habías apostado, y no había forma de volver a verlos).
    const tuya = misJugadas.quinielaDe(interaction.user.id, quiniela.id);
    const embed = new EmbedBuilder()
        .setTitle(`🧾 ${quiniela.jornada} — ${deporte.name}`)
        .setDescription(
            (tuya ? "" : `Rellena la quiniela partido a partido con botones **1 / X / 2**.\n\n`) +
                `💰 Bote actual: **${bote}** monedas\n` +
                `🏆 El 90 % se reparte entre quien más acierte, con **${minimoAciertosQuiniela(partidos.length)}** aciertos ` +
                `como mínimo (si nadie llega, se devuelve lo apostado).\n\n` +
                `**Partidos:**\n${listado}`,
        )
        .setColor(0x2ecc71)
        .setFooter({ text: "1 = Local, X = Empate, 2 = Visitante" });
    if (tuya) {
        embed.addFields({ name: `🎟️ Tu quiniela (${tuya.cantidad} 🪙)`, value: lineaQuiniela(tuya.detalle) });
    }

    const row = new ActionRowBuilder().addComponents(
        tuya
            ? new ButtonBuilder()
                  .setCustomId(`misapuestas_activas_${interaction.user.id}`)
                  .setLabel("📋 Mis jugadas")
                  .setStyle(ButtonStyle.Primary)
            : new ButtonBuilder()
                  .setCustomId(`quiniela_apostar_${quiniela.id}`)
                  .setLabel("🎟️ Apostar quiniela")
                  .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`quiniela_refrescar_${deporteSeleccionado}`)
            .setLabel("🔄 Refrescar")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`apuestas_pagina_${deporteSeleccionado}_1`).setLabel("⚽ Partidos").setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row, filaPestanas(interaction.user.id, "apuestas")] };
}

/** Muestra la quiniela de una competición (la de `deporteForzado` si viene del botón Refrescar, que sustituye el mensaje). */
async function mostrar(interaction, deporteForzado = null) {
    const deporteSeleccionado = deporteForzado || interaction.options?.getString?.("deporte") || "laliga";
    const responder = (payload) => (deporteForzado && interaction.isButton?.() ? interaction.update(payload) : interaction.reply(payload));
    const deporte = DEPORTES[deporteSeleccionado];

    if (!deporte) {
        await interaction.reply({ content: "❌ Deporte no válido.", flags: MessageFlags.Ephemeral });
        return;
    }

    const quiniela = repo.ultimaQuinielaAbierta(deporteSeleccionado);
    if (!quiniela) {
        await responder(vistaSinQuiniela(interaction, deporte, deporteSeleccionado, esAdmin(interaction)));
        return;
    }
    await responder(vistaQuiniela(interaction, quiniela, deporte, deporteSeleccionado));
}

module.exports = { mostrar, vistaQuiniela, vistaSinQuiniela };
