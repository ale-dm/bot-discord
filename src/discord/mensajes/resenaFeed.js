// 📣 El mensaje del feed de reseñas (#573): título, estrellas, el extracto (nunca el de una con spoilers) y el autor,
// mencionado sin aviso. Lo envía discord/envios/resenaFeed.
const { EmbedBuilder } = require("discord.js");
const { estrellasTexto } = require("../../systems/plexResenas");
const { extracto } = require("../../systems/plexResenas/feed");

const COLOR = 0xe5a00d;
const AVISO_SPOILERS = "⚠️ contiene spoilers";

/** El payload de una reseña nueva para el canal del feed. */
function mensajeFeedResena(resena) {
    const anio = resena.tipo === "movie" && resena.anio ? ` (${resena.anio})` : "";
    const texto = resena.spoilers ? AVISO_SPOILERS : extracto(resena) || "_Sin texto_";
    const embed = new EmbedBuilder()
        .setTitle(`${resena.tipo === "show" ? "📺" : "🎬"} ${resena.titulo}${anio}`.slice(0, 256))
        .setDescription(`**${estrellasTexto(resena.nota)}**${resena.meGusta ? " ❤️" : ""}\n\n${texto}\n\n— <@${resena.userId}>`)
        .setFooter({ text: "Reseñas de Plex · /plex → ⭐ Reseñas" })
        .setColor(COLOR);
    return { content: `🍿 Nueva reseña de <@${resena.userId}>`, embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports = { AVISO_SPOILERS, mensajeFeedResena };
