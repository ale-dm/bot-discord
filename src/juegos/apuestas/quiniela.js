// Quiniela (una jornada de 10 partidos): el comando y el reparto de sus botones. Las reglas están en systems/apuestas/quinielas.js;
// el editor de pronósticos, en quiniela/editor.js, y los botones, en quiniela/botones.js.

const { MessageFlags } = require("discord.js");
const repo = require("../../repositorios/apuestas");
const dinero = require("../../systems/dinero");
const { logInfo } = require("../../core/logger");
const { filaTrasApostar } = require("../../paneles/misJugadas");
const { importeElegido } = require("../../paneles/importes");
const { QUINIELA_LOCK_MINUTES, obtenerPartidosQuiniela, apostarQuiniela, crearQuiniela } = require("../../systems/apuestas/quinielas");
const { sesionesQuiniela, getSesionKey } = require("./quiniela/editor");
const { ACCIONES_BOTON_QUINIELA } = require("./quiniela/botones");
const reglas = require("../../systems/apuestas/quinielaReglas");
const vista = require("./quiniela/vista");

const { SIN_EFECTIVO } = reglas;

/**
 * Crea la quiniela de la jornada de una competición con sus próximos 10 partidos (mínimo 5). La usan el botón
 * 🛠️ Crear quiniela de la quiniela y el panel de admin → ⚽ Apuestas. @returns {{ ok: boolean, mensaje: string }}
 */

module.exports = {
    crearQuiniela,
    componentHandlers: [
        // Prefijos más largos que los de apuestas.js ("apuestas_", "apuestas_modal_"), así que ganan.
        { types: ["button"], prefixes: ["quiniela_"], method: "handleButton", acl: "juegos" },
        { types: ["modal"], prefixes: ["quiniela_modal_"], method: "handleModal", acl: "juegos" },
    ],

    // Desde el botón "Refrescar" se llama con el deporte y la respuesta sustituye al mensaje.
    async run(client, interaction, deporteForzado = null) {
        await vista.mostrar(interaction, deporteForzado);
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const customId = interaction.customId;

        const accion = ACCIONES_BOTON_QUINIELA.find(([encaja]) => encaja(customId));
        if (accion) await accion[1](client, interaction, customId, userId);
    },

    async handleModal(client, interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith("quiniela_modal_confirmar_")) return;

        const quinielaId = parseInt(customId.replace("quiniela_modal_confirmar_", ""), 10);
        const quiniela = repo.quinielaAbierta(quinielaId);
        if (!quiniela) {
            await interaction.reply({ content: "❌ Quiniela no disponible.", flags: MessageFlags.Ephemeral });
            return;
        }

        const partidos = obtenerPartidosQuiniela(quinielaId);
        if (await cerradaPorTiempo(interaction, quinielaId, partidos)) return;

        const sesion = sesionesQuiniela.get(getSesionKey(interaction.user.id, quinielaId));
        const pronosticos = await pronosticosDelFormulario(interaction, sesion, quinielaId);
        if (pronosticos === null) return;

        const cantidad = importeElegido(interaction.fields);
        // Sin await entre las comprobaciones y el cobro: el tope diario y el cobro no pueden pasarse entre dos formularios.
        const aviso = reglas.avisoDeApuesta({
            userId: interaction.user.id,
            guildId: interaction.guildId,
            quinielaId,
            partidos: partidos.length,
            pronosticos,
            pronosticosCompletos: !sesion || sesion.pronosticos.every(Boolean),
            cantidad,
        });
        if (aviso) {
            await interaction.reply({ content: aviso, flags: MessageFlags.Ephemeral });
            return;
        }

        const userId = interaction.user.id;
        if (!apostarQuiniela({ userId, quinielaId, pronosticos, cantidad })) {
            await interaction.reply({ content: SIN_EFECTIVO, flags: MessageFlags.Ephemeral });
            return;
        }
        logInfo(`[Quiniela] ${interaction.user.tag} (${userId}) apostó ${cantidad} a la quiniela ${quinielaId}: ${pronosticos}`);
        sesionesQuiniela.delete(getSesionKey(userId, quinielaId));

        const saldoActual = dinero.efectivo(userId);
        await interaction.reply({
            content:
                `✅ Quiniela registrada.\n` +
                `🎟️ Pronósticos: \`${pronosticos}\`\n` +
                `💰 Apostado: \`${cantidad}\`\n` +
                `💵 Efectivo: \`${saldoActual}\``,
            components: [filaTrasApostar(userId, { deporte: quiniela.deporte, quiniela: true })],
            flags: MessageFlags.Ephemeral,
        });
    },
};

// Antes del primer partido la quiniela está cerrada. Se comprueba también al enviar el formulario: con uno abierto a
// tiempo se podía apostar con la jornada empezada. True si está cerrada (ya se ha avisado).
async function cerradaPorTiempo(interaction, quinielaId, partidos) {
    const primerPartido = reglas.cierreDeLaJornada(partidos);
    if (!primerPartido) return false;
    logInfo(
        `[Quiniela] Apuesta rechazada de ${interaction.user.tag}: quiniela ${quinielaId} ya bloqueada (primer partido ${primerPartido})`,
    );
    await interaction.reply({
        content: `🔒 La quiniela se cerró ${QUINIELA_LOCK_MINUTES} minutos antes del primer partido; ya no se admiten apuestas.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

// Los pronósticos del formulario: los de la sesión del editor o, si no hay, los del campo de texto antiguo.
// Null si la sesión ha expirado (ya se ha avisado).
async function pronosticosDelFormulario(interaction, sesion, quinielaId) {
    if (sesion) return sesion.pronosticos.join("");
    try {
        const legacy = interaction.fields.getTextInputValue("pronosticos") || "";
        return legacy.trim().toUpperCase().replace(/\s+/g, "");
    } catch (e) {
        logInfo(`[Quiniela] Sesión de pronósticos expirada para ${interaction.user.id} (quiniela ${quinielaId})`);
        await interaction.reply({
            content: "❌ Sesión expirada. Vuelve a pulsar en Apostar quiniela.",
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }
}
