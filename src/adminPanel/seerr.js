const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const seerrClient = require("../services/seerrClient");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_seerr_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

function buildSeerrHome(guildId) {
    const { url, dailyRequestLimit } = seerrClient.getConfig(guildId);
    const allowedChannels = seerrClient.getAllowedChannels(guildId);
    const canalesTexto = allowedChannels.length ? allowedChannels.map((c) => `<#${c.channelId}>`).join(", ") : "todos (sin restricción)";

    const embed = new EmbedBuilder()
        .setTitle("🍿 Seerr (peticiones de contenido)")
        .setDescription(
            `Servidor Seerr: ${url || "no configurado"}\n` +
                `Límite de peticiones por IA y por persona: ${dailyRequestLimit}/día\n` +
                `Canales donde se puede pedir/buscar contenido: ${canalesTexto}\n\n` +
                `La atribución de quién pide qué se resuelve automáticamente: primero mirando el Discord ID que cada uno tenga guardado en su perfil de Seerr, y si no lo tiene, con el vínculo de Plex ya existente (🎬 Plex → Vincular).`,
        )
        .setColor(0x8e44ef)
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_seerr_test").setLabel("🔌 Test conexión").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_seerr_limit").setLabel("🔢 Límite diario").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_seerr_channel_add").setLabel("📺 Permitir canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_seerr_channel_remove").setLabel("➖ Quitar canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_seerr_channel_clear").setLabel("🧹 Sin restricción").setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row1, row2, navRow()] };
}

async function handleSeerrButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_seerr_home") {
        await interaction.update(buildSeerrHome(guildId));
        return true;
    }

    if (id === "paneladmin_seerr_test") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await seerrClient.testConnection(guildId);
        if (result.ok) {
            await interaction.editReply(`✅ Conexión con Seerr correcta (v${result.version}).`);
        } else {
            await interaction.editReply(`❌ No se pudo conectar con Seerr: ${result.error}`);
        }
        return true;
    }

    if (id === "paneladmin_seerr_limit") {
        await interaction.showModal(
            simpleModal("paneladmin_seerr_limit_modal", "Límite diario de peticiones IA", [
                { id: "limit", label: "Peticiones por persona y día (0 = sin límite)", placeholder: "5" },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_seerr_channel_add") {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("paneladmin_seerr_channel_add_select")
                .setPlaceholder("Selecciona un canal donde permitir pedir/buscar en Seerr")
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        );
        await interaction.reply({
            content: "¿En qué canal se puede pedir/buscar contenido? (en cuanto añadas el primero, el resto de canales dejan de poder)",
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (id === "paneladmin_seerr_channel_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_seerr_channel_remove_modal", "Quitar canal permitido", [
                { id: "channel_id", label: "ID del canal", placeholder: "123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_seerr_channel_clear") {
        seerrClient.clearAllowedChannels(guildId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "seerr.channels.clear" });
        await interaction.reply({
            content: "✅ Sin restricción: se puede pedir/buscar en Seerr en cualquier canal.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    return false;
}

async function handleSeerrChannelSelect(interaction) {
    if (interaction.customId === "paneladmin_seerr_channel_add_select") {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        seerrClient.addAllowedChannel(interaction.guildId, channelId, channel?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "seerr.channels.add",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Seerr permitido en <#${channelId}>.`, flags: MessageFlags.Ephemeral });
        return true;
    }
    return false;
}

async function handleSeerrModal(interaction) {
    if (interaction.customId === "paneladmin_seerr_channel_remove_modal") {
        const channelId = interaction.fields.getTextInputValue("channel_id").trim();
        if (!/^\d{17,19}$/.test(channelId)) {
            await interaction.reply({ content: "ID de canal inválido.", flags: MessageFlags.Ephemeral });
            return true;
        }
        seerrClient.removeAllowedChannel(interaction.guildId, channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "seerr.channels.remove",
            details: { channelId },
        });
        await interaction.reply({ content: "✅ Canal quitado de la lista de Seerr.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === "paneladmin_seerr_limit_modal") {
        const raw = interaction.fields.getTextInputValue("limit").trim();
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
            await interaction.reply({ content: "Número inválido.", flags: MessageFlags.Ephemeral });
            return true;
        }
        guildSettings.setSetting(interaction.guildId, "seerr.daily_request_limit", num);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "seerr.limit.set",
            details: { limit: num },
        });
        await interaction.reply({ content: `✅ Límite diario de peticiones IA: ${num || "sin límite"}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { buildSeerrHome, handleSeerrButton, handleSeerrChannelSelect, handleSeerrModal };
