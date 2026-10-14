// El DM semanal de logros sin reclamar (#378). Las reglas están en systems/logros/recordatorio.
const { EmbedBuilder } = require("discord.js");

function embedPendientes(guild, cuantos) {
    return new EmbedBuilder()
        .setTitle("🏅 Tienes logros sin reclamar")
        .setDescription(
            `En **${guild.name}** tienes **${cuantos}** ${cuantos === 1 ? "logro completado" : "logros completados"} con recompensa sin cobrar.\n` +
                `Reclámalos en \`/perfil\` → 🏅 Logros.`,
        )
        .setColor(0xf39c12)
        .setTimestamp();
}

module.exports = { embedPendientes };
