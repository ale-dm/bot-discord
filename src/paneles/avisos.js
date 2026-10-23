// 🔔 Panel de /avisos (#431): un desplegable con todos los tipos de DM y un botón de «no molestar». Se pinta con el
// estado de systems/avisosDm.js. Con más de 25 tipos habría que paginar; el desplegable admite 25.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const avisosDm = require("../systems/avisosDm");

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
                "\n\nElige un aviso en el desplegable para encenderlo o apagarlo. Vale para todos los servidores. " +
                "Las alertas de administración no se pueden apagar desde aquí.",
        );
    const select = new StringSelectMenuBuilder()
        .setCustomId("avisos_sel")
        .setPlaceholder("Enciende o apaga un aviso")
        .addOptions(
            e.tipos.map((t) => ({
                label: t.nombre,
                value: t.id,
                emoji: t.emoji,
                description: t.detalle.slice(0, 100),
            })),
        );
    const filaSelect = new ActionRowBuilder().addComponents(select);
    const filaNm = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("avisos_nm")
            .setLabel(e.noMolestar ? "Quitar no molestar" : "No molestar")
            .setEmoji("🌙")
            .setStyle(e.noMolestar ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [filaSelect, filaNm] };
}

module.exports = { buildAvisos };
