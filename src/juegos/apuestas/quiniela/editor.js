// Editor de la quiniela: la sesión de pronósticos de cada persona, y lo que se ve (embed y filas de botones).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { DEPORTES } = require("../../../services/oddsApi");
const { QUINIELA_LOCK_MINUTES, estaBloqueadoPorTiempo } = require("../../../systems/apuestas/quinielas");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);
const sesionesQuiniela = new Map();

function getSesionKey(userId, quinielaId) {
    return `${userId}:${quinielaId}`;
}

// Repinta el editor de la quiniela (embed y botones) con la pantalla del partido actual.
async function refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion) {
    const deporte = DEPORTES[quiniela.deporte] || DEPORTES.laliga;
    const embed = renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion);
    const rows = renderQuinielaEditorRows(quinielaId, sesion, partidos.length);
    await interaction.update({ embeds: [embed], components: rows });
}

function renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion) {
    const lineas = partidos
        .map((p, idx) => {
            const marca = idx === sesion.currentIndex ? "▶" : "•";
            const pick = sesion.pronosticos[idx] || "-";
            return `${marca} ${p.orden}. ${p.home_team} vs ${p.away_team}  [${pick}]`;
        })
        .join("\n");

    const actual = partidos[sesion.currentIndex];
    const actualDate = new Date(actual.start_time);
    const actualHora = actualDate.toLocaleString("es-ES");
    const bloqueado = estaBloqueadoPorTiempo(actual.start_time);
    const progreso = sesion.pronosticos.filter(Boolean).length;

    return new EmbedBuilder()
        .setTitle(`🧾 ${quiniela.jornada} — ${deporte.name}`)
        .setDescription(
            `Selecciona los pronósticos uno a uno con los botones **1 / X / 2**.\n\n` +
                `**Partidos**\n${lineas}\n\n` +
                `**Seleccionado:** ${actual.orden}. ${actual.home_team} vs ${actual.away_team}\n` +
                `**Hora:** ${actualHora}\n` +
                `**Estado:** ${bloqueado ? `🔒 Bloqueado (faltan < ${QUINIELA_LOCK_MINUTES} min)` : `🟢 Abierto`}\n` +
                `**Progreso:** ${progreso}/${partidos.length} | Cadena: \`${sesion.pronosticos.map((p) => p || "-").join("")}\``,
        )
        .setColor(0x3498db)
        .setFooter({ text: "1 = Local, X = Empate, 2 = Visitante" });
}

function renderQuinielaEditorRows(quinielaId, sesion, totalPartidos) {
    const completa = sesion.pronosticos.every(Boolean);
    const selectedLocked = sesion.currentStartTime ? estaBloqueadoPorTiempo(sesion.currentStartTime) : false;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_1`)
            .setLabel("1")
            .setStyle(ButtonStyle.Success)
            .setDisabled(selectedLocked),
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_X`)
            .setLabel("X")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(selectedLocked),
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_2`)
            .setLabel("2")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(selectedLocked),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_prev_${quinielaId}`)
            .setLabel("⬅️ Anterior")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(sesion.currentIndex === 0),
        new ButtonBuilder()
            .setCustomId(`quiniela_next_${quinielaId}`)
            .setLabel("Siguiente ➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(sesion.currentIndex >= totalPartidos - 1),
        new ButtonBuilder().setCustomId(`quiniela_clear_${quinielaId}`).setLabel("🧹 Limpiar").setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_confirmar_${quinielaId}`)
            .setLabel("✅ Confirmar pronósticos")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!completa),
        new ButtonBuilder().setCustomId(`quiniela_cancelar_${quinielaId}`).setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger),
    );

    return [row1, row2, row3];
}

module.exports = {
    MAX_BET_AMOUNT,
    MIN_BET_AMOUNT,
    sesionesQuiniela,
    getSesionKey,
    refrescarEditor,
    renderQuinielaEditorEmbed,
    renderQuinielaEditorRows,
};
