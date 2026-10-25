// 🔔 Panel de /avisos (#431): un desplegable con todos los tipos de DM y un botón de «no molestar». Se pinta con el
// estado de systems/avisosDm.js. Cada desplegable admite 25 tipos: los que sobran van en un segundo desplegable.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const avisosDm = require("../systems/avisosDm");

const MAX_OPCIONES = 25;

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
    // Un desplegable admite 25 opciones: a partir de ahí, los avisos siguen en otro.
    const filasSelect = [];
    for (let i = 0; i < e.tipos.length; i += MAX_OPCIONES) {
        const parte = e.tipos.slice(i, i + MAX_OPCIONES);
        const select = new StringSelectMenuBuilder()
            .setCustomId(i === 0 ? "avisos_sel" : `avisos_sel_${i / MAX_OPCIONES + 1}`)
            .setPlaceholder(i === 0 ? "Enciende o apaga un aviso" : "Más avisos")
            .addOptions(
                parte.map((t) => ({
                    label: t.nombre,
                    value: t.id,
                    emoji: t.emoji,
                    description: t.detalle.slice(0, 100),
                })),
            );
        filasSelect.push(new ActionRowBuilder().addComponents(select));
    }
    const filaNm = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("avisos_nm")
            .setLabel(e.noMolestar ? "Quitar no molestar" : "No molestar")
            .setEmoji("🌙")
            .setStyle(e.noMolestar ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [...filasSelect, filaNm] };
}

module.exports = { buildAvisos };
