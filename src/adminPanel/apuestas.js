// Panel admin → ⚽ Apuestas: lo que hay en juego (partidos con apuestas pendientes y quinielas abiertas), 💸 Liquidar
// ahora (antes /pagarapuestas; normalmente lo hace solo el cron de cada hora) y 🧾 Crear la quiniela de cada
// competición (también está en la propia quiniela).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../core/db");
const adminAudit = require("../systems/adminAudit");
const { DEPORTES } = require("../services/oddsApi");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");

function buildApuestasHome() {
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
    return { content: "", embeds: [embed], components: [acciones, crear] };
}

async function handleApuestasButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_apu_home") {
        await interaction.update(buildApuestasHome());
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

module.exports = { buildApuestasHome, handleApuestasButton };
