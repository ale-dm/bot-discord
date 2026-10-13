// Los embeds de los avisos de racha (DM): lo que ve la persona. Las reglas de la racha están en systems/xp/rachas (#472).
const { EmbedBuilder } = require("discord.js");

function buildStreakContinuedEmbed(guild, streakDias, bonusPct) {
    return new EmbedBuilder()
        .setTitle("🔥 ¡Racha activa!")
        .setDescription(`Llevas **${streakDias} días seguidos** ganando XP en **${guild.name}**.`)
        .addFields({ name: "Bonus actual", value: `+${bonusPct.toFixed(0)}% XP`, inline: true })
        .setColor(0xff6b35)
        .setFooter({ text: "Sigue así para no perder la racha" })
        .setTimestamp();
}

function buildStreakWarningEmbed(guild, streakDias) {
    return new EmbedBuilder()
        .setTitle("⏳ Tu racha está en peligro")
        .setDescription(
            `Llevas **${streakDias} días** de racha en **${guild.name}**, pero hoy todavía no has ganado XP.\n` +
                `Escribe un mensaje o entra a un canal de voz antes de medianoche para no perderla.`,
        )
        .setColor(0xe74c3c)
        .setTimestamp();
}

module.exports = { buildStreakContinuedEmbed, buildStreakWarningEmbed };
