// Panel admin → ⚽ Apuestas: lo que hay en juego (partidos con apuestas pendientes y quinielas abiertas), 💸 Liquidar
// ahora (antes /pagarapuestas; normalmente lo hace solo el cron de cada hora), 🧾 Crear la quiniela de cada
// competición (también está en la propia quiniela), el canal donde se publican los resultados (y el ⭐ partido destacado
// del día), el recordatorio por DM antes de cada partido, los 🚦 límites por jugador (tope diario y máximo por partido,
// F-AP-09) y los 🏆 premios de la liga de pronósticos.
// La pantalla está en apuestas/vistas.js y los botones en apuestas/botones.js; este fichero reúne los selectores y modales.
const { MessageFlags } = require("discord.js");
const adminAudit = require("../systems/adminAudit");
const guildSettings = require("../systems/guildSettings");
const { buildApuestasHome } = require("./apuestas/vistas");
const { handleApuestasButton } = require("./apuestas/botones");

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

async function handleLimitesModal(interaction) {
    const tope = Number(interaction.fields.getTextInputValue("tope").trim());
    const partido = Number(interaction.fields.getTextInputValue("partido").trim());
    if (![tope, partido].every((n) => Number.isInteger(n) && n >= 0 && n <= 100_000_000)) {
        await interaction.reply({
            content: "❌ Los límites tienen que ser números enteros, de 0 (sin límite) en adelante.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guildSettings.setManySettings(interaction.guildId, { "apuestas.tope_diario": tope, "apuestas.max_partido": partido });
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "apuestas.limites",
        details: { tope, partido },
    });
    if (interaction.isFromMessage?.()) await interaction.update(buildApuestasHome(interaction.guildId));
    else await interaction.reply({ content: "✅ Límites actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function handlePremiosModal(interaction) {
    const premios = ["p1", "p2", "p3"].map((id) => Number(interaction.fields.getTextInputValue(id).trim()));
    if (!premios.every((n) => Number.isInteger(n) && n >= 0 && n <= 100_000_000)) {
        await interaction.reply({
            content: "❌ Los premios tienen que ser números enteros, de 0 (ninguno) en adelante.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guildSettings.setManySettings(interaction.guildId, {
        "liga.premio_1": premios[0],
        "liga.premio_2": premios[1],
        "liga.premio_3": premios[2],
    });
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "apuestas.liga_premios",
        details: { premios },
    });
    if (interaction.isFromMessage?.()) await interaction.update(buildApuestasHome(interaction.guildId));
    else await interaction.reply({ content: "✅ Premios de la liga actualizados.", flags: MessageFlags.Ephemeral });
    return true;
}

async function handleApuestasModal(interaction) {
    if (interaction.customId === "paneladmin_apu_limites_modal") return handleLimitesModal(interaction);
    if (interaction.customId === "paneladmin_apu_premios_modal") return handlePremiosModal(interaction);
    if (interaction.customId !== "paneladmin_apu_recordatorio_modal") return false;
    const activo = interaction.fields.getRadioGroup("activo");
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
