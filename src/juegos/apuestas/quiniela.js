// Quiniela (una jornada de 10 partidos): el comando y el reparto de sus botones. Las reglas están en systems/apuestas/quinielas.js;
// el editor de pronósticos, en quiniela/editor.js, y los botones, en quiniela/botones.js.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const dinero = require("../../systems/dinero");
const limites = require("../../systems/apuestas/limites");
const { logInfo } = require("../../core/logger");
const { DEPORTES } = require("../../services/oddsApi");
const { minimoAciertosQuiniela } = require("../../systems/apuestas/liquidacion");
const misJugadas = require("../../systems/apuestas/misJugadas");
const { lineaQuiniela, filaTrasApostar } = require("../../paneles/misJugadas");
const { filaPestanas } = require("../../paneles/pestanasJuegos");
const { esAdmin } = require("../../core/permisos");
const {
    QUINIELA_LOCK_MINUTES,
    obtenerPartidosQuiniela,
    estaBloqueadoPorTiempo,
    yaApostoQuiniela,
    apostarQuiniela,
    crearQuiniela,
} = require("../../systems/apuestas/quinielas");
const { MAX_BET_AMOUNT, MIN_BET_AMOUNT, sesionesQuiniela, getSesionKey } = require("./quiniela/editor");
const { ACCIONES_BOTON_QUINIELA } = require("./quiniela/botones");

const SIN_EFECTIVO = "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar).";

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
        const deporteSeleccionado = deporteForzado || interaction.options?.getString?.("deporte") || "laliga";
        const responder = (payload) =>
            deporteForzado && interaction.isButton?.() ? interaction.update(payload) : interaction.reply(payload);
        const deporte = DEPORTES[deporteSeleccionado];

        if (!deporte) {
            await interaction.reply({ content: "❌ Deporte no válido.", flags: MessageFlags.Ephemeral });
            return;
        }

        const quiniela = db
            .prepare(
                `
            SELECT id, deporte, jornada, estado, creador_id, creada_en, cerrada_en FROM quinielas
            WHERE estado = 'abierta' AND deporte = ?
            ORDER BY id DESC
            LIMIT 1
        `,
            )
            .get(deporteSeleccionado);

        if (!quiniela) {
            await responder(vistaSinQuiniela(interaction, deporte, deporteSeleccionado, esAdmin(interaction)));
            return;
        }
        await responder(vistaQuiniela(interaction, quiniela, deporte, deporteSeleccionado));
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
        const quiniela = db
            .prepare(
                `SELECT id, deporte, jornada, estado, creador_id, creada_en, cerrada_en FROM quinielas WHERE id = ? AND estado = 'abierta'`,
            )
            .get(quinielaId);
        if (!quiniela) {
            await interaction.reply({ content: "❌ Quiniela no disponible.", flags: MessageFlags.Ephemeral });
            return;
        }

        const partidos = obtenerPartidosQuiniela(quinielaId);
        if (await cerradaPorTiempo(interaction, quinielaId, partidos)) return;

        const sesion = sesionesQuiniela.get(getSesionKey(interaction.user.id, quinielaId));
        const pronosticos = await pronosticosDelFormulario(interaction, sesion, quinielaId);
        if (pronosticos === null) return;

        const cantidad = parseInt(interaction.fields.getTextInputValue("cantidad"), 10);
        // Sin await entre las comprobaciones y el cobro: el tope diario y el cobro no pueden pasarse entre dos formularios.
        const aviso = avisoDeFormulario({ interaction, quinielaId, partidos, sesion, pronosticos, cantidad });
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
    const bote =
        db
            .prepare(
                `
            SELECT COALESCE(SUM(cantidad), 0) AS total FROM quiniela_apuestas WHERE quiniela_id = ?
        `,
            )
            .get(quiniela.id)?.total || 0;

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

// Antes del primer partido la quiniela está cerrada. Se comprueba también al enviar el formulario: con uno abierto a
// tiempo se podía apostar con la jornada empezada. True si está cerrada (ya se ha avisado).
async function cerradaPorTiempo(interaction, quinielaId, partidos) {
    const primerPartido = partidos.map((p) => p.start_time).sort()[0];
    if (!primerPartido || !estaBloqueadoPorTiempo(primerPartido)) return false;
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

// Las comprobaciones de la apuesta, en orden. Devuelve el aviso de la primera que falle, o null si se puede cobrar.
// Síncrona a propósito: el tope diario va justo antes del cobro, sin await por medio.
function avisoDeFormulario({ interaction, quinielaId, partidos, sesion, pronosticos, cantidad }) {
    const userId = interaction.user.id;
    if (pronosticos.length !== partidos.length || /[^12X]/.test(pronosticos) || (sesion && !sesion.pronosticos.every(Boolean))) {
        return "❌ Pronósticos incompletos o inválidos. Completa todos los partidos antes de confirmar.";
    }
    if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
        return `❌ Cantidad inválida. Debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT}.`;
    }
    // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino); antes le salía
    // "saldo insuficiente" hasta que usara otro comando que le creara la cuenta.
    // Se apuesta con el 💵 efectivo + 🥷 dinero negro (systems/dinero, F-EC-06b: se gasta igual).
    if (dinero.saldoGastable(userId) < cantidad) return SIN_EFECTIVO;
    if (yaApostoQuiniela(quinielaId, userId)) return "⚠️ Ya has apostado esta quiniela.";

    // 🚦 Tope diario del servidor (F-AP-09), que suma partidos y quiniela.
    const limite = limites.comprobar(interaction.guildId, userId, cantidad);
    if (limite) {
        logInfo(`[Quiniela] Apuesta de ${interaction.user.tag} (${cantidad}) rechazada por los límites: ${limite}`);
        return `🚦 ${limite}`;
    }
    return null;
}
