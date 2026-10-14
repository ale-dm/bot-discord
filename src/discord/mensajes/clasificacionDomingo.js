// El DM del domingo a quien va primero en la clasificación semanal (#394). Las reglas están en systems/clasificacion/avisoDomingo.
const { EmbedBuilder } = require("discord.js");

/** `lista`: [{ categoria: { emoji, nombre }, premio }] de las categorías en las que va primero. */
function embedDomingo(lista) {
    const lineas = lista.map(
        (l) => `${l.categoria.emoji} **${l.categoria.nombre}**${l.premio > 0 ? `: cobrarías **${l.premio.toLocaleString("es")}** 🪙` : ""}`,
    );
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("🏆 ¡Vas primero esta semana!")
                .setDescription(`${lineas.join("\n")}\n\nSi la semana acabara ahora, ganarías el lunes. ¡Aún tienes la tarde!`)
                .setColor(0xf1c40f)
                .setFooter({ text: "Puedes quitar este aviso en tu perfil o en /avisos" })
                .setTimestamp(),
        ],
    };
}

module.exports = { embedDomingo };
