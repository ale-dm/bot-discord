// El mensaje del partido destacado del día: embed con cuotas y los botones para apostar (#472).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { DEPORTES } = require("../../services/oddsApi");
const marcadorExacto = require("../../systems/apuestas/marcador");

function mensajeDestacado(partido) {
    const unix = Math.floor(Date.parse(partido.start_time) / 1000);
    const comp = DEPORTES[partido.deporte] || DEPORTES.laliga;
    const apuestas = partido.apuestas
        ? `\n\n🔥 Ya hay **${partido.apuestas}** ${partido.apuestas === 1 ? "apuesta" : "apuestas"} a este partido`
        : "";
    const embed = new EmbedBuilder()
        .setTitle("⭐ Partido destacado del día")
        .setDescription(
            `${comp.emoji} **${partido.home_team}** vs **${partido.away_team}** · ${comp.name}\n` +
                `🕘 <t:${unix}:t> (<t:${unix}:R>)\n\n` +
                `🏠 **${partido.home_team}**: cuota \`${partido.cuota_home}\`\n` +
                `🤝 **Empate**: cuota \`${partido.cuota_draw}\`\n` +
                `🚩 **${partido.away_team}**: cuota \`${partido.cuota_away}\`` +
                apuestas,
        )
        .setFooter({ text: "Pulsa un resultado para apostar · Más partidos en /juegos → ⚽ Apuestas" })
        .setColor(0xf1c40f);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`apuesta_home_${partido.match_id}`)
            .setLabel(`🏠 ${partido.home_team}`.slice(0, 80))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`apuesta_draw_${partido.match_id}`).setLabel("🤝 Empate").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`apuesta_away_${partido.match_id}`)
            .setLabel(`🚩 ${partido.away_team}`.slice(0, 80))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`apuesta_exacto_${partido.match_id}`)
            .setLabel(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`)
            .setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila] };
}

module.exports = { mensajeDestacado };
