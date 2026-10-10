// Panel admin → Niveles → 🚫 Canales ignorados: canales donde no se gana XP.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { modalConCampos, canalElegido } = require("../common");

async function boton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_ignored") {
        const ignored = xp.getIgnoredChannels(guildId);
        const lines = ignored.map((c) => `• <#${c.channelId}>`).join("\n") || "No hay canales ignorados.";
        const embed = new EmbedBuilder().setTitle("🚫 Canales ignorados XP").setDescription(lines).setColor(0x636e72);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_add").setLabel("➕ Ignorar canal").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_remove").setLabel("➖ Quitar").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_clear").setLabel("🧹 Limpiar").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
        return true;
    }

    if (id === "paneladmin_levels_ignored_add") {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("paneladmin_levels_ignored_add_select")
                .setPlaceholder("Selecciona canal")
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
        );
        await interaction.reply({ content: "Selecciona canal a ignorar:", components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_levels_ignored_remove") {
        await interaction.showModal(
            modalConCampos("paneladmin_levels_ignored_remove_modal", "Quitar canal ignorado", [
                { id: "channel_id", label: "Canal a quitar", tipo: "canal" },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_ignored_clear") {
        xp.clearIgnoredChannels(guildId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.ignored.clear" });
        await interaction.reply({ content: "✅ Canales ignorados limpiados.", flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function modal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_ignored_remove_modal") {
        const channelId = canalElegido(interaction.fields, "channel_id");
        if (!channelId) {
            await interaction.reply({ content: "Elige un canal.", flags: MessageFlags.Ephemeral });
            return true;
        }
        xp.removeIgnoredChannel(guildId, channelId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.ignored.remove", details: { channelId } });
        await interaction.reply({ content: "✅ Canal quitado de ignorados.", flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function selectCanal(interaction) {
    if (interaction.customId === "paneladmin_levels_ignored_add_select") {
        const channelId = interaction.values[0];
        const ch = interaction.guild.channels.cache.get(channelId);
        xp.addIgnoredChannel(interaction.guildId, channelId, ch?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "xp.ignored.add",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal ignorado: <#${channelId}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { boton, modal, selectCanal };
