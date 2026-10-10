// Panel admin → ⚽ Apuestas, botones: refrescar, avisos (canal, recordatorio, destacado), límites, premios, liquidar
// ahora y crear la quiniela de cada competición.
const { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, MessageFlags } = require("discord.js");
const adminAudit = require("../../systems/adminAudit");
const guildSettings = require("../../systems/guildSettings");
const { simpleModal, modalConCampos, SI_NO_NUMERICO } = require("../common");
const { createLogger } = require("../../core/logger");
const { buildApuestasHome } = require("./vistas");

const log = createLogger("PanelAdmin");

async function abrirSelectorCanal(interaction) {
    await interaction.reply({
        content: "¿En qué canal se publican los resultados de las apuestas y quinielas?",
        components: [
            new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId("paneladmin_apu_canal_select")
                    .setPlaceholder("Canal de resultados")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

async function quitarCanal(interaction) {
    guildSettings.setSetting(interaction.guildId, "apuestas.canal_resultados", "");
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: "apuestas.canal.quitar" });
    await interaction.update(buildApuestasHome(interaction.guildId));
}

async function abrirModalRecordatorio(interaction) {
    const cfg = guildSettings.getSettings(interaction.guildId).apuestas;
    await interaction.showModal(
        modalConCampos("paneladmin_apu_recordatorio_modal", "Recordatorio antes del partido", [
            { id: "activo", label: "Recordatorio activo", tipo: "radio", opciones: SI_NO_NUMERICO, valor: cfg.recordatorio ? "1" : "0" },
            { id: "minutos", label: "Minutos antes del partido (5-1440)", value: String(cfg.recordatorio_min) },
        ]),
    );
}

async function abrirModalLimites(interaction) {
    const cfg = guildSettings.getSettings(interaction.guildId).apuestas;
    await interaction.showModal(
        simpleModal("paneladmin_apu_limites_modal", "Límites de apuestas por jugador", [
            { id: "tope", label: "Tope diario en 🪙 (0 = sin límite)", value: String(cfg.tope_diario) },
            { id: "partido", label: "Máximo por partido en 🪙 (0 = sin límite)", value: String(cfg.max_partido) },
        ]),
    );
}

async function abrirModalPremios(interaction) {
    const liga = guildSettings.getSettings(interaction.guildId).liga;
    await interaction.showModal(
        simpleModal("paneladmin_apu_premios_modal", "Premios de la liga (🪙)", [
            { id: "p1", label: "1.º puesto en 🪙 (0 = ninguno)", value: String(liga.premio_1) },
            { id: "p2", label: "2.º puesto en 🪙 (0 = ninguno)", value: String(liga.premio_2) },
            { id: "p3", label: "3.º puesto en 🪙 (0 = ninguno)", value: String(liga.premio_3) },
        ]),
    );
}

// ⭐ Partido destacado del día (F-AP-07): activar o desactivar.
async function alternarDestacado(interaction) {
    const activo = !guildSettings.getSettings(interaction.guildId).apuestas.destacado;
    guildSettings.setSetting(interaction.guildId, "apuestas.destacado", activo);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "apuestas.destacado",
        details: { activo },
    });
    await interaction.update(buildApuestasHome(interaction.guildId));
}

const BOTONES_AVISOS = new Map([
    ["paneladmin_apu_canal", abrirSelectorCanal],
    ["paneladmin_apu_canal_quitar", quitarCanal],
    ["paneladmin_apu_recordatorio", abrirModalRecordatorio],
    ["paneladmin_apu_limites", abrirModalLimites],
    ["paneladmin_apu_premios", abrirModalPremios],
    ["paneladmin_apu_destacado", alternarDestacado],
]);

async function liquidarAhora(interaction) {
    const liquidacion = require("../../systems/apuestas/liquidacion");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    log.info(`Liquidación manual de apuestas por ${interaction.user.tag}`);
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: "apuestas.liquidar" });
    let resumen;
    try {
        resumen = await liquidacion.liquidarApuestas({ origen: `manual:${interaction.user.username}` });
    } catch (e) {
        log.error("Error en la liquidación manual:", e);
        await interaction.editReply({ content: `❌ ${e.message}` });
        return true;
    }
    if (!resumen) {
        await interaction.editReply({ content: "⏳ Ya hay una liquidación en marcha, prueba en un momento." });
        return true;
    }
    void liquidacion.avisarGanadores(interaction.client, resumen.pagos);
    void liquidacion.anunciarResultados(interaction.client, resumen);
    void require("../../juegos/retos/retos").actualizarMensajes(interaction.client, resumen.retosCerrados);
    await interaction.editReply({ embeds: [liquidacion.resumenEmbed(resumen)] });
    return true;
}

async function crearQuiniela(interaction) {
    const deporte = interaction.customId.replace("paneladmin_apu_quiniela_", "");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await require("../../juegos/apuestas/quiniela").crearQuiniela(deporte, interaction.user.id);
    if (r.ok)
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "quiniela.create",
            details: { deporte },
        });
    await interaction.editReply({ content: r.mensaje });
    return true;
}

async function handleApuestasButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_apu_home") {
        await interaction.update(buildApuestasHome(interaction.guildId));
        return true;
    }
    const accionAviso = BOTONES_AVISOS.get(id);
    if (accionAviso) {
        await accionAviso(interaction);
        return true;
    }
    if (id === "paneladmin_apu_liquidar") return liquidarAhora(interaction);
    if (id.startsWith("paneladmin_apu_quiniela_")) return crearQuiniela(interaction);
    return false;
}

module.exports = { handleApuestasButton };
