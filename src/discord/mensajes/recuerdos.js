// El DM a los admins con un recuerdo que el Duende propone guardar, con sus dos botones (#472).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

function mensajePropuesta(propuesta) {
    const embed = new EmbedBuilder()
        .setTitle("🧠 Recuerdo propuesto")
        .setDescription(`Sobre <@${propuesta.userId}>: «${propuesta.texto}»\n\n¿Lo guardo en su perfil del Duende?`)
        .setColor(0x9b59b6);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`recuerdo_auto_ok_${propuesta.id}`).setLabel("✅ Guardar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`recuerdo_auto_edit_${propuesta.id}`).setLabel("✏️ Editar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`recuerdo_auto_no_${propuesta.id}`).setLabel("❌ Descartar").setStyle(ButtonStyle.Danger),
    );
    return { embed, fila };
}

/** El formulario para corregir el texto de una propuesta antes de guardarla (#386). */
function formularioEdicion(id, texto) {
    return new ModalBuilder()
        .setCustomId(`recuerdo_auto_modal_${id}`)
        .setTitle("✏️ Editar el recuerdo")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("texto")
                    .setLabel("Qué guardar en su perfil")
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(3)
                    .setMaxLength(200)
                    .setValue(String(texto).slice(0, 200))
                    .setRequired(true),
            ),
        );
}

module.exports = { mensajePropuesta, formularioEdicion };
