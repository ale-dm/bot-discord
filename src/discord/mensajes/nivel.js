// El embed de la subida de nivel que se anuncia en el canal (systems/xp/roles pasa los datos, #472).
const { EmbedBuilder } = require("discord.js");

function embedSubidaNivel({ mention, newLevel, currentTitle, upcomingTitle, nextNeed, rewardRole, guildName }) {
    return new EmbedBuilder()
        .setTitle("🎉 ¡Subida de nivel!")
        .setDescription(`${mention} alcanzó el **Nivel ${newLevel}**`)
        .addFields(
            { name: "Rango actual", value: `${currentTitle.emoji || "▫️"} **${currentTitle.title || "SIN RANGO"}**`, inline: true },
            { name: "XP próximo nivel", value: `${nextNeed}`, inline: true },
            {
                name: "Siguiente rango",
                value: upcomingTitle
                    ? `${upcomingTitle.emoji || "▫️"} ${upcomingTitle.title} (LV ${upcomingTitle.nivel})`
                    : "🏁 Máximo rango",
                inline: true,
            },
            {
                name: "Recompensa de nivel",
                value: rewardRole?.roleId ? `<@&${rewardRole.roleId}>` : "Sin recompensa de rol en este nivel",
                inline: false,
            },
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Servidor: ${guildName}` })
        .setTimestamp();
}

module.exports = { embedSubidaNivel };
