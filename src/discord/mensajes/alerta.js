// El embed de una alerta de administración por DM (systems/alertas pasa los datos, #472).
const { EmbedBuilder } = require("discord.js");

function embedAlerta(titulo, detalle, at) {
    return new EmbedBuilder()
        .setTitle(titulo.slice(0, 256))
        .setDescription(String(detalle || "").slice(0, 3000))
        .setColor(0xe74c3c)
        .setFooter({ text: "El Duende · se configura en /paneladmin → 🩺 Sistema → 🔔 Alertas" })
        .setTimestamp(at);
}

module.exports = { embedAlerta };
