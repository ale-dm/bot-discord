// 🎬 El mensaje de una sesión de cine: qué, cuándo (en la hora de cada uno) y quién se ha apuntado, con los botones.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const cine = require("../systems/cine");

function pantallaSesion(id) {
    const s = cine.sesion(id);
    const personas = cine.asistentes(id);
    const unix = Math.floor(new Date(s.inicio).getTime() / 1000);
    const embed = new EmbedBuilder()
        .setTitle(s.cancelada ? `🎬 ~~${s.peli}~~ (cancelada)` : `🎬 ${s.peli}`)
        .setDescription(
            `**Cuándo:** <t:${unix}:F> (<t:${unix}:R>)\n` +
                `**Convoca:** <@${s.organizador}>\n\n` +
                `**Apuntados (${personas.length}):** ${personas.length ? personas.map((u) => `<@${u}>`).join(" ") : "nadie todavía"}`,
        )
        .setColor(s.cancelada ? 0x95a5a6 : 0xe67e22)
        .setFooter({ text: `Te avisamos ${cine.AVISO_MIN} minutos antes a quien se haya apuntado.` });

    if (s.cancelada) return { content: "", embeds: [embed], components: [], allowedMentions: { parse: [] } };
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cine_apuntarse_${id}`).setLabel("🙋 Me apunto").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cine_salirse_${id}`).setLabel("🚪 Me salgo").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`cine_cancelar_${id}`).setLabel("🛑 Cancelar sesión").setStyle(ButtonStyle.Danger),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

module.exports = { pantallaSesion };
