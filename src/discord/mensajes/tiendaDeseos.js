// El DM de la lista de deseos de la tienda (#404): un objeto que sigues vuelve a tener stock o ha bajado de precio.
const { EmbedBuilder } = require("discord.js");

function embedDeseo(item, motivo) {
    const precio = item.enOferta ? `~~${item.precioLista}~~ **${item.precio}** 🪙 (🏷️ -${item.descuento} %)` : `**${item.precio}** 🪙`;
    return new EmbedBuilder()
        .setTitle(motivo === "stock" ? "⭐ ¡Ya hay stock de lo que seguías!" : "⭐ ¡Ha bajado de precio lo que seguías!")
        .setDescription(`**${item.nombre}** — ${precio}\nCómpralo en \`/tienda\`.`)
        .setColor(0xf1c40f)
        .setTimestamp();
}

module.exports = { embedDeseo };
