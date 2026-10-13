// 🔔 Panel de /avisos (#431): un interruptor por cada tipo de DM del bot y "no molestar". Se pinta con el estado de
// systems/avisosDm.js; los botones son avisos_t_{tipo} (interruptor de un tipo) y avisos_nm (no molestar).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const avisosDm = require("../systems/avisosDm");
const { trozos } = require("./filas");

function buildAvisos(userId) {
    const e = avisosDm.estado(userId);
    const lineas = e.tipos.map((t) => `${t.activo ? "🟢" : "⚪"} ${t.emoji} **${t.nombre}** — ${t.detalle}`);
    const embed = new EmbedBuilder()
        .setTitle("🔔 Tus avisos por DM")
        .setColor(e.noMolestar ? 0x95a5a6 : 0x3498db)
        .setDescription(
            (e.noMolestar
                ? "🌙 **No molestar está activado:** no te mando ningún aviso, aunque tengas los interruptores encendidos.\n\n"
                : "") +
                lineas.join("\n") +
                "\n\nPulsa un botón para encender o apagar ese aviso. Vale para todos los servidores. " +
                "Las alertas de administración no se pueden apagar desde aquí.",
        );
    const botones = e.tipos.map((t) =>
        new ButtonBuilder()
            .setCustomId(`avisos_t_${t.id}`)
            .setLabel(t.nombre)
            .setEmoji(t.emoji)
            .setStyle(t.activo ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    botones.push(
        new ButtonBuilder()
            .setCustomId("avisos_nm")
            .setLabel(e.noMolestar ? "Quitar no molestar" : "No molestar")
            .setEmoji("🌙")
            .setStyle(e.noMolestar ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
    return { embeds: [embed], components: trozos(botones).map((g) => new ActionRowBuilder().addComponents(...g)) };
}

module.exports = { buildAvisos };
