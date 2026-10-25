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
                "🎞️ **Wrapped**: el resumen del mes pasado (y, con un botón, el del año).\n" +
                "🏅 **Mi Plex**: tus horas, tus trofeos y tus logros de Plex.\n" +
                "⭐ **Reseñas**: puntúa lo que ves, mira la media del servidor y lo que opinan los demás, y 🎲 la ruleta si no sabes qué ver.\n" +
                "📺 **Series**: sigue series y te aviso por DM de los episodios nuevos.\n" +
                "📝 **Quiero ver**: apunta lo que quieres ver y te aviso cuando llegue a Plex.\n" +
                "📡 **Ahora**: qué se está viendo en este momento.\n" +
                "🗓️ **Estrenos**: lo que se estrena esta semana, con 📥 para pedirlo.\n" +
                "🏆 **Campeones**: quién ha ganado el ranking semanal.\n" +
                "📥 **Mis pedidos**: tus peticiones pendientes de Seerr, para cancelarlas.",
        )
        .setColor(0xe5a00d);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plex_cine").setLabel("🎬 Sesión de cine").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("plex_para_ti").setLabel("🎯 Para ti").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("plex_wrapped").setLabel("🎞️ Wrapped").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plex_perfil").setLabel("🏅 Mi Plex").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plexx_ahora").setLabel("📡 Ahora").setStyle(ButtonStyle.Secondary),
    );
    const avisos = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plex_series").setLabel("📺 Series").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plex_quiero").setLabel("📝 Quiero ver").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plexx_estrenos").setLabel("🗓️ Estrenos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plexx_campeones").setLabel("🏆 Campeones").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("plexx_pedidos").setLabel("📥 Mis pedidos").setStyle(ButtonStyle.Secondary),
    );
    const resenas = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("plex_resenas").setLabel("⭐ Reseñas").setStyle(ButtonStyle.Primary),
    );
    return { content: "", embeds: [embed], components: [fila, avisos, resenas] };
}

module.exports = { pantallaPlex };
