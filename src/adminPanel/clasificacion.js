// Panel admin → ⚙️ Config Global → 🏆 Semanal: la clasificación semanal con premios (F-EC-03). Canal donde se publica
// (sin canal, ni se publica ni se paga), premio de cada categoría, cuándo fue la última y quién ganaría si fuera ahora.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const clasificacion = require("../systems/clasificacionSemanal");
const { simpleModal, fmt } = require("./common");

function buildClasificacionHome(guildId, aviso = "") {
    const cfg = guildSettings.getSettings(guildId).clasificacion;
    const semana = clasificacion.semanaAnterior();
    const g = clasificacion.ganadores(guildId, semana);
    const quien = (x, detalle) => (x ? `<@${x.userId}> (${detalle(x)})` : "nadie");
    const embed = new EmbedBuilder()
        .setTitle("🏆 Clasificación semanal")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Cada lunes a las 10:00 (hora de Madrid) se publica en su canal y se paga el premio al efectivo de: 💰 el más rico " +
                "(efectivo + banco), 💬 el más activo (más XP ganada desde la anterior) y ⚽ el mejor apostador (más beneficio en lo " +
                "resuelto la semana anterior, si ganó algo).",
        )
        .addFields(
            { name: "📢 Canal", value: cfg.canal ? `<#${cfg.canal}>` : "Ninguno: no se publica ni se paga nada", inline: true },
            { name: "🪙 Premio", value: `**${fmt(cfg.premio)}** 🪙 por categoría`, inline: true },
            { name: "📅 Última", value: cfg.ultima_semana ? `semana del ${cfg.ultima_semana}` : "todavía ninguna", inline: true },
            {
                name: "👀 Si fuera ahora",
                value:
                    `💰 ${quien(g.rico, (x) => `${fmt(x.total)} 🪙`)}\n` +
                    `💬 ${quien(g.activo, (x) => `+${fmt(x.xp)} XP`)}\n` +
                    `⚽ ${quien(g.apostador, (x) => `+${fmt(x.beneficio)} 🪙`)}`,
            },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_semanal_canal").setLabel("📢 Canal").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("paneladmin_semanal_canal_quitar")
            .setLabel("🔕 Quitar canal")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!cfg.canal),
        new ButtonBuilder().setCustomId("paneladmin_semanal_premio").setLabel("🪙 Premio").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

async function handleClasificacionButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_semanal_home") {
        await interaction.update(buildClasificacionHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_semanal_canal") {
        await interaction.reply({
            content: "¿En qué canal se publica la clasificación semanal?",
            components: [
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId("paneladmin_semanal_canal_select")
                        .setPlaceholder("Canal de la clasificación")
                        .setMinValues(1)
                        .setMaxValues(1)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (id === "paneladmin_semanal_canal_quitar") {
        guildSettings.setSetting(interaction.guildId, "clasificacion.canal", "");
        adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: "clasificacion.canal.quitar" });
        await interaction.update(buildClasificacionHome(interaction.guildId, "🔕 Ya no se publica ni se paga la clasificación."));
        return true;
    }
    if (id === "paneladmin_semanal_premio") {
        const cfg = guildSettings.getSettings(interaction.guildId).clasificacion;
        await interaction.showModal(
            simpleModal("paneladmin_semanal_premio_modal", "Premio de la clasificación", [
                { id: "premio", label: "Monedas por categoría (0 = sin premio)", value: String(cfg.premio) },
            ]),
        );
        return true;
    }
    return false;
}

async function handleClasificacionChannelSelect(interaction) {
    if (interaction.customId !== "paneladmin_semanal_canal_select") return false;
    const canalId = interaction.values[0];
    guildSettings.setSetting(interaction.guildId, "clasificacion.canal", canalId);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "clasificacion.canal",
        details: { canalId },
    });
    await interaction.reply({
        content: `✅ La clasificación semanal se publicará en <#${canalId}> los lunes a las 10:00.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function handleClasificacionModal(interaction) {
    if (interaction.customId !== "paneladmin_semanal_premio_modal") return false;
    const premio = Number(interaction.fields.getTextInputValue("premio").trim());
    if (!Number.isInteger(premio) || premio < 0 || premio > 1_000_000) {
        await interaction.reply({
            content: "❌ El premio tiene que ser un número entero de 0 a 1.000.000.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guildSettings.setSetting(interaction.guildId, "clasificacion.premio", premio);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "clasificacion.premio",
        details: { premio },
    });
    const payload = buildClasificacionHome(interaction.guildId, "✅ Premio actualizado.");
    if (interaction.isFromMessage?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildClasificacionHome, handleClasificacionButton, handleClasificacionChannelSelect, handleClasificacionModal };
