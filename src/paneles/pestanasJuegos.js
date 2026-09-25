// Fila de pestañas de /juegos (el userId se acepta por compatibilidad; los ids ya no lo llevan), igual en todas sus pantallas principales: 🎰 Casino · ⚽ Apuestas ·
// 📋 Mis jugadas · 📊 Stats. La pestaña en la que estás sale resaltada.
// Cada pestaña tiene su propio customId (juegos_*): Discord rechaza un mensaje con dos botones con el mismo
// id, y las pantallas ya tienen botones como "⏳ En juego" (misapuestas_activas_…) o "🎰 Casino".
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const PESTANAS = [
    { id: "casino", label: "🎰 Casino", customId: "juegos_casino" },
    { id: "apuestas", label: "⚽ Apuestas", customId: "juegos_apuestas_laliga" },
    { id: "jugadas", label: "📋 Mis jugadas", customId: "juegos_jugadas" },
    { id: "stats", label: "📊 Stats", customId: "juegos_stats" },
];

function filaPestanas(_userId, actual) {
    return new ActionRowBuilder().addComponents(
        PESTANAS.map((p) =>
            new ButtonBuilder()
                .setCustomId(p.customId)
                .setLabel(p.label)
                .setStyle(p.id === actual ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );
}

module.exports = { filaPestanas };
