// El DM a los admins con un recuerdo que el Duende propone guardar, con sus dos botones (#472).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function mensajePropuesta(propuesta) {
    const embed = new EmbedBuilder()
        .setTitle("🧠 Recuerdo propuesto")
        .setDescription(`Sobre <@${propuesta.userId}>: «${propuesta.texto}»\n\n¿Lo guardo en su perfil del Duende?`)
        .setColor(0x9b59b6);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`recuerdo_auto_ok_${propuesta.id}`).setLabel("✅ Guardar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`recuerdo_auto_no_${propuesta.id}`).setLabel("❌ Descartar").setStyle(ButtonStyle.Danger),
    );
    return { embed, fila };
}

module.exports = { mensajePropuesta };
