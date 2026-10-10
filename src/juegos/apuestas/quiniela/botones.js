// Botones de la quiniela: refrescar, crear, apostar, elegir pronósticos, navegar, cancelar y confirmar.

const { EmbedBuilder, ModalBuilder, MessageFlags } = require("discord.js");
const { filasImporte } = require("../../../paneles/importes");
const db = require("../../../core/db");
const { DEPORTES } = require("../../../services/oddsApi");
const { esAdmin } = require("../../../core/permisos");
const {
    QUINIELA_LOCK_MINUTES,
    obtenerPartidosQuiniela,
    estaBloqueadoPorTiempo,
    crearQuiniela,
} = require("../../../systems/apuestas/quinielas");
const {
    MAX_BET_AMOUNT,
    MIN_BET_AMOUNT,
    sesionesQuiniela,
    getSesionKey,
    refrescarEditor,
    renderQuinielaEditorEmbed,
    renderQuinielaEditorRows,
} = require("./editor");

// Botones de la quiniela, en orden: el primero cuyo prefijo encaja se atiende (ver handleButton de module.exports).
async function botonRefrescar(client, interaction, customId) {
    const deporteSeleccionado = customId.replace("quiniela_refrescar_", "");
    // Antes se pasaba una copia {...interaction}, que no tiene reply/update (son de la clase):
    // el botón fallaba siempre.
    await require("../quiniela").run(client, interaction, deporteSeleccionado);
}

async function botonCrear(client, interaction, customId) {
    const isAdmin = esAdmin(interaction);
    if (!isAdmin) {
        await interaction.reply({ content: "❌ Solo administradores pueden crear quinielas.", flags: MessageFlags.Ephemeral });
        return;
    }
    const r = await crearQuiniela(customId.replace("quiniela_crear_", ""), interaction.user.id);
    await interaction.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
}

async function botonApostar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_apostar_", ""), 10);
    const quiniela = db
        .prepare(
            `SELECT id, deporte, jornada, estado, creador_id, creada_en, cerrada_en FROM quinielas WHERE id = ? AND estado = 'abierta'`,
        )
        .get(quinielaId);
    if (!quiniela) {
        await interaction.reply({ content: "❌ La quiniela ya no está disponible.", flags: MessageFlags.Ephemeral });
        return;
    }

    const yaAposto = db.prepare(`SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?`).get(quinielaId, userId);
    if (yaAposto) {
        await interaction.reply({ content: "⚠️ Ya has enviado una apuesta para esta quiniela.", flags: MessageFlags.Ephemeral });
        return;
    }

    const partidos = obtenerPartidosQuiniela(quinielaId);
    const sesion = {
        currentIndex: 0,
        pronosticos: new Array(partidos.length).fill(null),
        currentStartTime: partidos[0]?.start_time,
        createdAt: Date.now(),
    };
    sesionesQuiniela.set(getSesionKey(userId, quinielaId), sesion);

    const deporte = DEPORTES[quiniela.deporte] || DEPORTES.laliga;
    const embed = renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion);
    const rows = renderQuinielaEditorRows(quinielaId, sesion, partidos.length);
    await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

// Sesión y quiniela abierta de quien pulsa, o null si ya no valen (ya se ha avisado).
async function sesionYQuinielaAbierta(interaction, userId, quinielaId) {
    const sesion = sesionesQuiniela.get(getSesionKey(userId, quinielaId));
    const quiniela = db
        .prepare(
            `SELECT id, deporte, jornada, estado, creador_id, creada_en, cerrada_en FROM quinielas WHERE id = ? AND estado = 'abierta'`,
        )
        .get(quinielaId);
    if (!sesion || !quiniela) {
        await interaction.reply({
            content: "❌ Sesión no válida o expirada. Pulsa de nuevo en Apostar quiniela.",
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }
    return { sesion, quiniela };
}

async function botonPick(client, interaction, customId, userId) {
    const parts = customId.split("_");
    const quinielaId = parseInt(parts[2], 10);
    const pick = parts[3];
    const abierta = await sesionYQuinielaAbierta(interaction, userId, quinielaId);
    if (!abierta) return;
    const { sesion, quiniela } = abierta;

    const partidos = obtenerPartidosQuiniela(quinielaId);
    const actual = partidos[sesion.currentIndex];
    if (!actual) {
        await interaction.reply({ content: "❌ Partido no válido en la quiniela.", flags: MessageFlags.Ephemeral });
        return;
    }

    if (estaBloqueadoPorTiempo(actual.start_time)) {
        await interaction.reply({
            content: `🔒 Ese partido está bloqueado porque faltan menos de ${QUINIELA_LOCK_MINUTES} minutos para empezar.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    sesion.pronosticos[sesion.currentIndex] = pick;
    if (sesion.currentIndex < partidos.length - 1) sesion.currentIndex += 1;
    sesion.currentStartTime = partidos[sesion.currentIndex]?.start_time;

    await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
}

// Ir al partido anterior o siguiente, o quitar el pronóstico del partido actual.
async function botonNavegar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.split("_")[2], 10);
    const abierta = await sesionYQuinielaAbierta(interaction, userId, quinielaId);
    if (!abierta) return;
    const { sesion, quiniela } = abierta;

    const partidos = obtenerPartidosQuiniela(quinielaId);
    if (customId.startsWith("quiniela_prev_")) sesion.currentIndex = Math.max(0, sesion.currentIndex - 1);
    else if (customId.startsWith("quiniela_next_")) sesion.currentIndex = Math.min(partidos.length - 1, sesion.currentIndex + 1);
    else sesion.pronosticos[sesion.currentIndex] = null;
    sesion.currentStartTime = partidos[sesion.currentIndex]?.start_time;

    await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
}

async function botonCancelar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_cancelar_", ""), 10);
    sesionesQuiniela.delete(getSesionKey(userId, quinielaId));
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle("❌ Apuesta cancelada")
                .setDescription("Se canceló tu sesión de quiniela. Puedes empezar de nuevo cuando quieras.")
                .setColor(0xe74c3c),
        ],
        components: [],
    });
}

// Con todos los partidos pronosticados, pide la cantidad en un formulario.
async function botonConfirmar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_confirmar_", ""), 10);
    const sesion = sesionesQuiniela.get(getSesionKey(userId, quinielaId));
    if (!sesion || !sesion.pronosticos.every(Boolean)) {
        await interaction.reply({ content: "❌ Completa todos los partidos antes de confirmar.", flags: MessageFlags.Ephemeral });
        return;
    }

    const modal = new ModalBuilder().setCustomId(`quiniela_modal_confirmar_${quinielaId}`).setTitle("Confirmar apuesta quiniela");

    modal.addComponents(
        ...filasImporte({
            textoEtiqueta: `Otra cantidad (${MIN_BET_AMOUNT}-${MAX_BET_AMOUNT})`,
            placeholder: "Ejemplo: 100",
        }),
    );
    await interaction.showModal(modal);
}

const ACCIONES_BOTON_QUINIELA = [
    [(id) => id.startsWith("quiniela_refrescar_"), botonRefrescar],
    [(id) => id.startsWith("quiniela_crear_"), botonCrear],
    [(id) => id.startsWith("quiniela_apostar_"), botonApostar],
    [(id) => id.startsWith("quiniela_pick_"), botonPick],
    [(id) => id.startsWith("quiniela_prev_") || id.startsWith("quiniela_next_") || id.startsWith("quiniela_clear_"), botonNavegar],
    [(id) => id.startsWith("quiniela_cancelar_"), botonCancelar],
    [(id) => id.startsWith("quiniela_confirmar_"), botonConfirmar],
];

module.exports = {
    botonRefrescar,
    botonCrear,
    botonApostar,
    sesionYQuinielaAbierta,
    botonPick,
    botonNavegar,
    botonCancelar,
    botonConfirmar,
    ACCIONES_BOTON_QUINIELA,
};
