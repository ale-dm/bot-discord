const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    UserSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
} = require("discord.js");
const plexLinks = require("../systems/plexLinks");
const tautulliClient = require("../services/tautulliClient");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

function buildPlexHome(guildId) {
    const links = plexLinks.getLinks(guildId);
    const lines = links.length
        ? links.map((l) => `• <@${l.discordUserId}> → **${l.plexUsername || l.tautulliUserId}**`).join("\n")
        : "Nadie vinculado todavía.";

    const { url } = tautulliClient.getConfig(guildId);
    const { novedades_channel_id } = guildSettings.getSettings(guildId).plex;
    const allowedChannels = tautulliClient.getAllowedChannels(guildId);
    const canalesTexto = allowedChannels.length ? allowedChannels.map((c) => `<#${c.channelId}>`).join(", ") : "todos (sin restricción)";

    const embed = new EmbedBuilder()
        .setTitle("🎬 Plex / Tautulli")
        .setDescription(
            `Servidor Tautulli: ${url || "no configurado"}\n` +
                `Canal de novedades: ${novedades_channel_id ? `<#${novedades_channel_id}>` : "desactivado"}\n` +
                `Canales donde se puede preguntar por Plex: ${canalesTexto}\n\n` +
                `**Vinculados (${links.length})**\n${lines}`,
        )
        .setColor(0xe5a00d)
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_link").setLabel("➕ Vincular").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_plex_unlink").setLabel("🗑️ Quitar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_plex_test").setLabel("🔌 Test conexión").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_novedades_channel").setLabel("📢 Canal novedades").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_plex_novedades_clear")
            .setLabel("🚫 Desactivar novedades")
            .setStyle(ButtonStyle.Secondary),
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_add").setLabel("📺 Permitir canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_remove").setLabel("➖ Quitar canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_clear").setLabel("🧹 Sin restricción").setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row1, row2, row3, navRow()] };
}

async function handlePlexButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_plex_home") {
        await interaction.update(buildPlexHome(guildId));
        return true;
    }

    if (id === "paneladmin_plex_link") {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId("paneladmin_plex_link_select")
                .setPlaceholder("Selecciona el usuario de Discord")
                .setMinValues(1)
                .setMaxValues(1),
        );
        await interaction.reply({ content: "¿A quién quieres vincular con Plex?", components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_plex_unlink") {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId("paneladmin_plex_unlink_select")
                .setPlaceholder("Selecciona el usuario a desvincular")
                .setMinValues(1)
                .setMaxValues(1),
        );
        await interaction.reply({ content: "¿A quién quieres desvincular de Plex?", components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_plex_test") {
        await interaction.deferReply({ ephemeral: true });
        const result = await tautulliClient.testConnection(guildId);
        if (result.ok) {
            await interaction.editReply(`✅ Conexión con Tautulli correcta. ${result.userCount} usuarios visibles.`);
        } else {
            await interaction.editReply(`❌ No se pudo conectar con Tautulli: ${result.error}`);
        }
        return true;
    }

    if (id === "paneladmin_plex_novedades_channel") {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("paneladmin_plex_novedades_channel_select")
                .setPlaceholder("Selecciona el canal de novedades")
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        );
        await interaction.reply({ content: "¿En qué canal se anuncian las novedades de Plex?", components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_plex_novedades_clear") {
        guildSettings.setSetting(guildId, "plex.novedades_channel_id", "");
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.novedades.clear" });
        await interaction.reply({ content: "✅ Novedades automáticas desactivadas.", ephemeral: true });
        return true;
    }

    if (id === "paneladmin_plex_channel_add") {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("paneladmin_plex_channel_add_select")
                .setPlaceholder("Selecciona un canal donde permitir preguntar por Plex")
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        );
        await interaction.reply({
            content: "¿En qué canal se puede preguntar por Plex? (en cuanto añadas el primero, el resto de canales dejan de poder)",
            components: [row],
            ephemeral: true,
        });
        return true;
    }

    if (id === "paneladmin_plex_channel_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_plex_channel_remove_modal", "Quitar canal permitido", [
                { id: "channel_id", label: "ID del canal", placeholder: "123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_plex_channel_clear") {
        tautulliClient.clearAllowedChannels(guildId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.channels.clear" });
        await interaction.reply({ content: "✅ Sin restricción: se puede preguntar por Plex en cualquier canal.", ephemeral: true });
        return true;
    }

    return false;
}

async function handlePlexChannelSelect(interaction) {
    if (interaction.customId === "paneladmin_plex_novedades_channel_select") {
        const channelId = interaction.values[0];
        guildSettings.setSetting(interaction.guildId, "plex.novedades_channel_id", channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.novedades.set",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal de novedades: <#${channelId}>`, ephemeral: true });
        return true;
    }

    if (interaction.customId === "paneladmin_plex_channel_add_select") {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        tautulliClient.addAllowedChannel(interaction.guildId, channelId, channel?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.channels.add",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Plex permitido en <#${channelId}>.`, ephemeral: true });
        return true;
    }

    return false;
}

async function handlePlexUserSelect(interaction) {
    if (interaction.customId === "paneladmin_plex_link_select") {
        const discordUserId = interaction.values[0];
        await interaction.showModal(
            simpleModal(`paneladmin_plex_link_modal_${discordUserId}`, "Vincular con Plex", [
                { id: "plex_username", label: "Usuario de Tautulli/Plex (exacto)", placeholder: "SrAaleeeo" },
            ]),
        );
        return true;
    }

    if (interaction.customId === "paneladmin_plex_unlink_select") {
        const discordUserId = interaction.values[0];
        plexLinks.removeLink(interaction.guildId, discordUserId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.unlink",
            details: { discordUserId },
        });
        await interaction.reply({ content: `✅ <@${discordUserId}> desvinculado de Plex.`, ephemeral: true });
        return true;
    }

    return false;
}

async function handlePlexModal(interaction) {
    if (interaction.customId === "paneladmin_plex_channel_remove_modal") {
        const channelId = interaction.fields.getTextInputValue("channel_id").trim();
        if (!/^\d{17,19}$/.test(channelId)) {
            await interaction.reply({ content: "ID de canal inválido.", ephemeral: true });
            return true;
        }
        tautulliClient.removeAllowedChannel(interaction.guildId, channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.channels.remove",
            details: { channelId },
        });
        await interaction.reply({ content: "✅ Canal quitado de la lista de Plex.", ephemeral: true });
        return true;
    }

    if (!interaction.customId.startsWith("paneladmin_plex_link_modal_")) return false;

    const discordUserId = interaction.customId.replace("paneladmin_plex_link_modal_", "");
    const query = interaction.fields.getTextInputValue("plex_username").trim();
    const guildId = interaction.guildId;

    let users;
    try {
        users = await tautulliClient.getUsers(guildId);
    } catch (e) {
        log.warn(`Vincular Plex: no se pudo consultar Tautulli para buscar "${query}":`, e.message);
        await interaction.reply({ content: `❌ No se pudo consultar Tautulli: ${e.message}`, ephemeral: true });
        return true;
    }

    const match = users.find((u) => String(u.username || "").toLowerCase() === query.toLowerCase());
    if (!match) {
        await interaction.reply({
            content: `❌ No encuentro a "${query}" en Tautulli. Usa el nombre exacto de usuario de Plex.`,
            ephemeral: true,
        });
        return true;
    }

    plexLinks.setLink(guildId, discordUserId, match.user_id, match.username);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "plex.link",
        details: { discordUserId, tautulliUserId: match.user_id, plexUsername: match.username },
    });
    await interaction.reply({ content: `✅ <@${discordUserId}> vinculado a **${match.username}**.`, ephemeral: true });
    return true;
}

module.exports = { buildPlexHome, handlePlexButton, handlePlexUserSelect, handlePlexModal, handlePlexChannelSelect };
