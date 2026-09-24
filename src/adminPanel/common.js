const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");

function isAdmin(interaction) {
    const ok = !!interaction.member?.permissions?.has("Administrator");
    if (!ok)
        log.warn(
            `Intento de usar el panel de admin sin permisos: ${interaction.user?.tag} (${interaction.user?.id}) · ${interaction.customId || interaction.commandName || "?"}`,
        );
    return ok;
}

function fmt(n) {
    return Number(n || 0).toLocaleString("es");
}

function simpleModal(customId, title, inputs) {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
    const rows = inputs.map((i) =>
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(i.id)
                .setLabel(i.label)
                .setStyle(i.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(i.required ?? true)
                .setPlaceholder(i.placeholder || "")
                .setMaxLength(i.maxLength || 4000)
                .setValue(i.value || ""),
        ),
    );
    modal.addComponents(...rows);
    return modal;
}

module.exports = { isAdmin, fmt, simpleModal };
