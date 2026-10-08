// 🎯 Recomendaciones personales (#22): la lista para quien la pide, con un 📥 por título para pedirlo en Seerr.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const ETIQUETA_TIPO = { movie: "Película", tv: "Serie" };

function pantallaRecomendaciones(resultado) {
    if (!resultado.ok) {
        return {
            content: "",
            embeds: [new EmbedBuilder().setTitle("🎯 Para ti").setDescription(resultado.motivo).setColor(0x95a5a6)],
            components: [],
        };
    }
    if (!resultado.sugerencias.length) {
        const embed = new EmbedBuilder()
            .setTitle("🎯 Para ti")
            .setDescription("Con lo que has visto no hay nada nuevo que recomendarte ahora mismo. 🤷")
            .setColor(0x95a5a6);
        return { content: "", embeds: [embed], components: [] };
    }
    const lineas = resultado.sugerencias.map((s, i) => {
        const porque = s.porque.slice(0, 2).join(", ");
        const anyo = s.anyo ? ` (${s.anyo})` : "";
        return `${i + 1}. **${s.titulo}**${anyo} · ${ETIQUETA_TIPO[s.mediaType] || s.mediaType}\n   Porque viste ${porque}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("🎯 Para ti")
        .setDescription(lineas.join("\n"))
        .setColor(0x9b59b6)
        .setFooter({ text: "Lo que ya has visto o ya está en Plex no sale. Pulsa 📥 para pedirlo en Seerr." });
    const fila = new ActionRowBuilder().addComponents(
        resultado.sugerencias.map((s) =>
            new ButtonBuilder()
                .setCustomId(`recomendar_pedir_${s.mediaType}_${s.tmdbId}`)
                .setLabel(`📥 ${s.titulo}`.slice(0, 80))
                .setStyle(ButtonStyle.Success),
        ),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

module.exports = { pantallaRecomendaciones };
