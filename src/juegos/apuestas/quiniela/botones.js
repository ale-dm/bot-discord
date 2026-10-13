// Botones de la quiniela: refrescar, crear, apostar, elegir pronósticos, navegar, cancelar y confirmar.

const { EmbedBuilder, ModalBuilder, MessageFlags } = require("discord.js");
const { filasImporte } = require("../../../paneles/importes");
const repo = require("../../../repositorios/apuestas");
const { DEPORTES } = require("../../../services/oddsApi");
const { esAdmin } = require("../../../core/permisos");
const {
    QUINIELA_LOCK_MINUTES,
    obtenerPartidosQuiniela,
    cuotasDeQuiniela,
    estaBloqueadoPorTiempo,
    crearQuiniela,
} = require("../../../systems/apuestas/quinielas");
const { sugerirPronosticos } = require("../../../systems/apuestas/quinielaReglas");
const {
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
} = require("./editor");
const vista = require("./vista");

// Botones de la quiniela, en orden: el primero cuyo prefijo encaja se atiende (ver handleButton de module.exports).
async function botonRefrescar(client, interaction, customId) {
    const deporteSeleccionado = customId.replace("quiniela_refrescar_", "");
    // Antes se pasaba una copia {...interaction}, que no tiene reply/update (son de la clase):
    // el botón fallaba siempre.
    await vista.mostrar(interaction, deporteSeleccionado);
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
    const quiniela = repo.quinielaAbierta(quinielaId);
    if (!quiniela) {
        await interaction.reply({ content: "❌ La quiniela ya no está disponible.", flags: MessageFlags.Ephemeral });
        return;
    }

    const yaAposto = repo.yaApostoQuiniela(quinielaId, userId);
    if (yaAposto) {
        await interaction.reply({ content: "⚠️ Ya has enviado una apuesta para esta quiniela.", flags: MessageFlags.Ephemeral });
        return;
    }

    // Si hay una sesión en marcha o un borrador guardado (#384), se sigue por ahí; si no, una vacía.
    const partidos = obtenerPartidosQuiniela(quinielaId);
    const sesion = obtenerSesion(userId, quinielaId) ?? nuevaSesion(partidos);
    sesionesQuiniela.set(getSesionKey(userId, quinielaId), sesion);

    const deporte = DEPORTES[quiniela.deporte] || DEPORTES.laliga;
    const embed = renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion);
    const rows = renderQuinielaEditorRows(quinielaId, sesion, partidos.length);
    await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

// Sesión y quiniela abierta de quien pulsa, o null si ya no valen (ya se ha avisado).
async function sesionYQuinielaAbierta(interaction, userId, quinielaId) {
    const sesion = obtenerSesion(userId, quinielaId);
    const quiniela = repo.quinielaAbierta(quinielaId);
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
    guardarBorrador(userId, quinielaId, sesion);
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
    else {
        sesion.pronosticos[sesion.currentIndex] = null;
        guardarBorrador(userId, quinielaId, sesion);
    }
    sesion.recuperado = false;
    sesion.currentStartTime = partidos[sesion.currentIndex]?.start_time;

    await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
}

async function botonCancelar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_cancelar_", ""), 10);
    descartarSesion(userId, quinielaId);
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

// 🎯 Rellenar favoritos (#366): los partidos sin pronóstico se rellenan con el favorito según la cuota; los que ya elegiste no cambian
// y se puede retocar cualquiera después.
async function botonSugerir(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_sugerir_", ""), 10);
    const abierta = await sesionYQuinielaAbierta(interaction, userId, quinielaId);
    if (!abierta) return;
    const { sesion, quiniela } = abierta;

    const partidos = obtenerPartidosQuiniela(quinielaId);
    const cuotas = cuotasDeQuiniela(quinielaId);
    const { pronosticos, rellenados } = sugerirPronosticos(
        partidos.map((p, i) => ({ ...p, ...cuotas[i] })),
        sesion.pronosticos,
    );
    if (!rellenados) {
        await interaction.reply({
            content: "🎯 No hay partidos sin pronóstico a los que sugerir uno (o no tienen cuotas, o ya están bloqueados).",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    sesion.pronosticos = pronosticos;
    guardarBorrador(userId, quinielaId, sesion);
    await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
}

// Con todos los partidos pronosticados, pide la cantidad en un formulario.
async function botonConfirmar(client, interaction, customId, userId) {
    const quinielaId = parseInt(customId.replace("quiniela_confirmar_", ""), 10);
    const sesion = obtenerSesion(userId, quinielaId);
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
    [(id) => id.startsWith("quiniela_sugerir_"), botonSugerir],
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
    botonSugerir,
    botonCancelar,
    botonConfirmar,
    ACCIONES_BOTON_QUINIELA,
};
