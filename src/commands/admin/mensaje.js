// ✉️ /mensaje: un admin escribe un mensaje privado (DM) de parte del bot a alguien. Eliges a quién por la opción
// «usuario» y el texto va en un formulario (campo de varias líneas); el DM lleva solo ese texto. Solo admins: un bot que
// escribe a cualquiera se puede usar mal. Cada envío queda en la auditoría (sin el texto, solo cuántos caracteres).
const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    MessageFlags,
} = require("discord.js");
const { isAdmin } = require("../../adminPanel/common");
const adminAudit = require("../../systems/adminAudit");
const { createLogger } = require("../../core/logger");

const log = createLogger("Mensaje");
const TEXTO_MAX = 1500; // deja sitio a la cabecera dentro de los 2000 caracteres de un DM

const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });

module.exports = {
    componentHandlers: [{ types: ["modal"], prefixes: ["mensaje_modal_"], method: "handleModal" }],
    data: new SlashCommandBuilder()
        .setName("mensaje")
        .setDescription("✉️ Manda un mensaje privado (DM) de parte del bot a alguien (solo admins)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName("usuario").setDescription("A quién se le manda").setRequired(true)),

    async run(client, interaction) {
        if (!isAdmin(interaction)) return interaction.reply(efimero("⛔ Solo los admins pueden mandar mensajes desde el bot."));
        const destino = interaction.options.getUser("usuario", true);
        if (destino.bot) return interaction.reply(efimero("❌ No tiene sentido mandarle un mensaje a un bot."));

        const texto = new TextInputBuilder()
            .setCustomId("texto")
            .setLabel("Mensaje")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Lo que le quieres decir. Le llega tal cual, como DM del bot.")
            .setMaxLength(TEXTO_MAX)
            .setRequired(true);
        const modal = new ModalBuilder()
            .setCustomId(`mensaje_modal_${destino.id}`)
            .setTitle(`✉️ Mensaje a ${destino.username}`.slice(0, 45))
            .addComponents(new ActionRowBuilder().addComponents(texto));
        return interaction.showModal(modal);
    },

    async handleModal(client, interaction) {
        if (!isAdmin(interaction)) return interaction.reply(efimero("⛔ Solo los admins pueden mandar mensajes desde el bot."));
        const destinoId = interaction.customId.slice("mensaje_modal_".length);
        const texto = interaction.fields.getTextInputValue("texto").trim();
        if (!texto) return interaction.reply(efimero("❌ El mensaje está vacío."));

        const destino = await client.users.fetch(destinoId).catch(() => null);
        if (!destino) return interaction.reply(efimero("❌ No encuentro a esa persona."));

        try {
            await destino.send({ content: texto });
        } catch (e) {
            // Suele ser que tiene cerrados los mensajes privados de los servidores.
            log.warn(`No pude mandar el DM a ${destinoId} de parte de ${interaction.user.username}: ${e.message}`);
            return interaction.reply(efimero(`❌ No pude mandarle el mensaje a **${destino.username}** (quizá tiene los DM cerrados).`));
        }

        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "mensaje.dm",
            details: { destinatario: destinoId, caracteres: texto.length },
        });
        log.info(`${interaction.user.username} mandó un DM a ${destinoId} desde ${interaction.guildId}`);
        return interaction.reply(efimero(`✅ Mensaje enviado a **${destino.username}**.`));
    },
};
