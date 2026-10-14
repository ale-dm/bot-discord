// Editor de la quiniela: la sesión de pronósticos de cada persona, y lo que se ve (embed y filas de botones).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { DEPORTES } = require("../../../services/oddsApi");
const { QUINIELA_LOCK_MINUTES, obtenerPartidosQuiniela, estaBloqueadoPorTiempo } = require("../../../systems/apuestas/quinielas");
const borrador = require("../../../systems/apuestas/borradorQuiniela");

const { MAX_BET_AMOUNT, MIN_BET_AMOUNT } = require("../../../systems/apuestas/quinielaReglas");
const sesionesQuiniela = new Map();

function getSesionKey(userId, quinielaId) {
    return `${userId}:${quinielaId}`;
}

/** Una sesión de edición para esta quiniela: con los pronósticos del borrador (`pronosticos`) o vacía. Empieza en el primer partido sin pronóstico. */
function nuevaSesion(partidos, pronosticos = null) {
    const lista = pronosticos || new Array(partidos.length).fill(null);
    const primero = Math.max(
        0,
        lista.findIndex((p) => !p),
    );
    return {
        currentIndex: primero,
        pronosticos: lista,
        currentStartTime: partidos[primero]?.start_time,
        createdAt: Date.now(),
        recuperado: Boolean(pronosticos),
    };
}

/**
 * La sesión de edición de una persona: la de memoria o, si no hay (el bot se reinició), la que sale de su borrador (#384). null si
 * no hay ninguna de las dos.
 */
function obtenerSesion(userId, quinielaId) {
    const clave = getSesionKey(userId, quinielaId);
    if (sesionesQuiniela.has(clave)) return sesionesQuiniela.get(clave);
    const partidos = obtenerPartidosQuiniela(quinielaId);
    const guardado = borrador.cargar(userId, quinielaId, partidos.length);
    if (!guardado) return null;
    const sesion = nuevaSesion(partidos, guardado);
    sesionesQuiniela.set(clave, sesion);
    return sesion;
}

/** Guarda en la base de datos los pronósticos de la sesión (el borrador, #384). */
function guardarBorrador(userId, quinielaId, sesion) {
    sesion.recuperado = false;
    borrador.guardar(userId, quinielaId, sesion.pronosticos);
}

/** Cierra la sesión de edición y borra el borrador (al apostar o cancelar). */
function descartarSesion(userId, quinielaId) {
    sesionesQuiniela.delete(getSesionKey(userId, quinielaId));
    borrador.borrar(userId, quinielaId);
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
            `Selecciona los pronósticos uno a uno con los botones **1 / X / 2**, o rellena los que falten con los favoritos.\n` +
                (sesion.recuperado ? "📝 Se ha recuperado tu borrador: tus pronósticos se guardan mientras eliges.\n" : "") +
                "\n" +
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
        new ButtonBuilder().setCustomId(`quiniela_sugerir_${quinielaId}`).setLabel("🎯 Rellenar favoritos").setStyle(ButtonStyle.Primary),
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
    nuevaSesion,
    obtenerSesion,
    guardarBorrador,
    descartarSesion,
    refrescarEditor,
    renderQuinielaEditorEmbed,
    renderQuinielaEditorRows,
};
