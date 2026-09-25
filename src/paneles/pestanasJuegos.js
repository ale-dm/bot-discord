// Fila de pestañas de /juegos, igual en todas sus pantallas principales: 🎰 Casino · ⚽ Apuestas ·
// 📋 Mis jugadas · 📊 Stats. La pestaña en la que estás sale resaltada.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const PESTANAS = [
    { id: "casino", label: "🎰 Casino", customId: () => "casino_home" },
    { id: "apuestas", label: "⚽ Apuestas", customId: () => "juegos_apuestas_laliga" },
    { id: "jugadas", label: "📋 Mis jugadas", customId: (userId) => `misapuestas_activas_${userId}` },
    { id: "stats", label: "📊 Stats", customId: () => "juegos_stats" },
];

function filaPestanas(userId, actual) {
    return new ActionRowBuilder().addComponents(
        PESTANAS.map((p) =>
            new ButtonBuilder()
                .setCustomId(p.customId(userId))
                .setLabel(p.label)
                .setStyle(p.id === actual ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );
}

module.exports = { filaPestanas };
