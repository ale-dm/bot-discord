// Piezas comunes de los paneles de /cripto.
const { ButtonBuilder, ButtonStyle } = require("discord.js");

function backButton(customId = "cripto_panel", label = "◀ Volver") {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary);
}

module.exports = { backButton };
