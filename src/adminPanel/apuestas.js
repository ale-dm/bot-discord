// Panel admin → ⚽ Apuestas: lo que hay en juego (partidos con apuestas pendientes y quinielas abiertas), 💸 Liquidar
// ahora (antes /pagarapuestas; normalmente lo hace solo el cron de cada hora), 🧾 Crear la quiniela de cada
// competición (también está en la propia quiniela), el canal donde se publican los resultados (y el ⭐ partido destacado
// del día) y el recordatorio por DM antes de cada partido.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const db = require("../core/db");
const adminAudit = require("../systems/adminAudit");
const guildSettings = require("../systems/guildSettings");
const { DEPORTES } = require("../services/oddsApi");
const { simpleModal } = require("./common");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");

function buildApuestasHome(guildId) {
    const cfg = guildSettings.getSettings(guildId).apuestas;
    const pendientes = db
        .prepare(
            `SELECT p.deporte, COUNT(DISTINCT p.match_id) AS partidos, COUNT(*) AS apuestas, COALESCE(SUM(a.cantidad), 0) AS importe
             FROM apuestas_usuario a JOIN apuestas_partidos p ON a.match_id = p.match_id
             WHERE a.pagado = 0 GROUP BY p.deporte`,
        )
        .all();
    const quinielas = db
        .prepare(
            `SELECT q.deporte, q.jornada, COUNT(qa.id) AS jugadores, COALESCE(SUM(qa.cantidad), 0) AS bote
             FROM quinielas q LEFT JOIN quiniela_apuestas qa ON qa.quiniela_id = q.id
             WHERE q.estado = 'abierta' GROUP BY q.id`,
        )
        .all();
    const caducados = db
        .prepare("SELECT COUNT(*) AS n FROM apuestas_partidos WHERE estado = 'caducado' AND start_time >= ?")
        .get(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).n;
    const nombre = (d) => DEPORTES[d]?.name || d;
    const embed = new EmbedBuilder()
        .setTitle("⚽ Apuestas")
        .setDescription("Se liquidan solas cada hora (minuto 15). 💸 Liquidar ahora lo fuerza.")
        .addFields(
            {
                name: "⏳ Apuestas pendientes",
                value:
                    pendientes
                        .map((r) => `• ${nombre(r.deporte)}: **${r.apuestas}** apuestas en ${r.partidos} partidos (${r.importe} 🪙)`)
                        .join("\n") || "Ninguna.",
            },
            {
                name: "🧾 Quinielas abiertas",
                value:
                    quinielas
                        .map((q) => `• ${nombre(q.deporte)} · ${q.jornada}: **${q.jugadores}** jugadores, bote ${q.bote} 🪙`)
                        .join("\n") || "Ninguna.",
            },
            { name: "↩️ Caducados (7 días)", value: `${caducados} partidos sin resultado (reembolsados)` },
            {
                name: "📢 Avisos",
                value:
                    `Resultados: ${cfg.canal_resultados ? `se publican en <#${cfg.canal_resultados}>` : "no se publican (solo DM a quien cobra)"}\n` +
                    `Recordatorio por DM: ${cfg.recordatorio ? `**${cfg.recordatorio_min} min** antes del partido` : "desactivado"}\n` +
                    `⭐ Partido destacado del día: ${
                        !cfg.destacado
                            ? "desactivado"
                            : cfg.canal_resultados
                              ? `cada día desde las 10:00 en <#${cfg.canal_resultados}>`
                              : "activo, pero hace falta el canal de resultados"
                    }`,
            },
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_apu_liquidar").setLabel("💸 Liquidar ahora").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_apu_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    const crear = new ActionRowBuilder().addComponents(
        Object.entries(DEPORTES).map(([key, d]) =>
            new ButtonBuilder()
                .setCustomId(`paneladmin_apu_quiniela_${key}`)
                .setLabel(`🧾 Crear quiniela ${d.name}`.slice(0, 80))
                .setStyle(ButtonStyle.Primary),
        ),
    );
    const avisos = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_apu_canal").setLabel("📢 Canal de resultados").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_apu_canal_quitar")
            .setLabel("🔕 No publicar")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!cfg.canal_resultados),
        new ButtonBuilder().setCustomId("paneladmin_apu_recordatorio").setLabel("⏰ Recordatorio").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_apu_destacado")
            .setLabel(cfg.destacado ? "⭐ Quitar el destacado" : "⭐ Publicar el destacado")
            .setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [acciones, crear, avisos] };
}

async function handleApuestasButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_apu_home") {
        await interaction.update(buildApuestasHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_apu_canal") {
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
        return true;
    }
    if (id === "paneladmin_apu_canal_quitar") {
        guildSettings.setSetting(interaction.guildId, "apuestas.canal_resultados", "");
        adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: "apuestas.canal.quitar" });
        await interaction.update(buildApuestasHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_apu_recordatorio") {
        const cfg = guildSettings.getSettings(interaction.guildId).apuestas;
        await interaction.showModal(
            simpleModal("paneladmin_apu_recordatorio_modal", "Recordatorio antes del partido", [
                { id: "activo", label: "Activo (1/0)", value: cfg.recordatorio ? "1" : "0" },
                { id: "minutos", label: "Minutos antes del partido (5-1440)", value: String(cfg.recordatorio_min) },
            ]),
        );
        return true;
    }
    // ⭐ Partido destacado del día (F-AP-07): activar o desactivar.
    if (id === "paneladmin_apu_destacado") {
        const activo = !guildSettings.getSettings(interaction.guildId).apuestas.destacado;
        guildSettings.setSetting(interaction.guildId, "apuestas.destacado", activo);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "apuestas.destacado",
            details: { activo },
        });
        await interaction.update(buildApuestasHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_apu_liquidar") {
        const liquidacion = require("../systems/apuestas/liquidacion");
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
        void require("../juegos/retos/retos").actualizarMensajes(interaction.client, resumen.retosCerrados);
        await interaction.editReply({ embeds: [liquidacion.resumenEmbed(resumen)] });
        return true;
    }
    if (id.startsWith("paneladmin_apu_quiniela_")) {
        const deporte = id.replace("paneladmin_apu_quiniela_", "");
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await require("../juegos/apuestas/quiniela").crearQuiniela(deporte, interaction.user.id);
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
    return false;
}

async function handleApuestasChannelSelect(interaction) {
    if (interaction.customId !== "paneladmin_apu_canal_select") return false;
    const canalId = interaction.values[0];
    guildSettings.setSetting(interaction.guildId, "apuestas.canal_resultados", canalId);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "apuestas.canal",
        details: { canalId },
    });
    await interaction.reply({
        content: `✅ Los resultados de las apuestas se publicarán en <#${canalId}> después de cada liquidación.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function handleApuestasModal(interaction) {
    if (interaction.customId !== "paneladmin_apu_recordatorio_modal") return false;
    const activo = interaction.fields.getTextInputValue("activo").trim();
    const minutos = Number(interaction.fields.getTextInputValue("minutos").trim());
    if (!Number.isInteger(minutos) || minutos < 5 || minutos > 1440) {
        await interaction.reply({
            content: "❌ Los minutos tienen que ser un número entero entre 5 y 1440.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guildSettings.setManySettings(interaction.guildId, { "apuestas.recordatorio": activo, "apuestas.recordatorio_min": minutos });
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "apuestas.recordatorio",
        details: { activo, minutos },
    });
    if (interaction.isFromMessage?.()) await interaction.update(buildApuestasHome(interaction.guildId));
    else await interaction.reply({ content: "✅ Recordatorio actualizado.", flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildApuestasHome, handleApuestasButton, handleApuestasChannelSelect, handleApuestasModal };
