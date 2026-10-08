// 🍿 /plex: el panel de todo lo de Plex (sesiones de cine, recomendaciones, el Wrapped y tu perfil de Plex), con botones.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const plexLinks = require("../systems/plexLinks");

function pantallaPlex(guildId, userId) {
    const vinculo = plexLinks.getLinkByDiscordId(guildId, String(userId));
    const estado = vinculo
        ? `✅ Tu cuenta de Plex está vinculada: **${vinculo.plexUsername}**.`
        : "⚠️ Tu cuenta de Plex no está vinculada: pídele a un admin que te vincule (para las recomendaciones, el Wrapped y tu perfil).";
    const embed = new EmbedBuilder()
        .setTitle("🍿 Plex")
        .setDescription(
            `${estado}\n\n` +
                "🎬 **Sesión de cine**: convoca a un grupo a ver algo a una hora y que se apunten con un botón.\n" +
                "🎯 **Para ti**: qué ver a partir de lo que ya has visto.\n" +
                "🎞️ **Wrapped**: el resumen del mes pasado.\n" +
                "🏅 **Mi Plex**: tus horas, tus trofeos y tus logros de Plex.",
        )
        .setColor(0xe5a00d);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plex_cine").setLabel("🎬 Sesión de cine").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("plex_para_ti").setLabel("🎯 Para ti").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("plex_wrapped").setLabel("🎞️ Wrapped").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plex_perfil").setLabel("🏅 Mi Plex").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

module.exports = { pantallaPlex };
