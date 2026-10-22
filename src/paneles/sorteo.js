// 🎁 Mensajes de los sorteos (#541): el mensaje público con el botón de entrar/salir, el resultado con los
// ganadores y la lista de /sorteos. Las reglas y el cierre, en systems/sorteos.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fmtNumero } = require("../core/formato");

const premioTexto = (s) => (s.premioTipo === "dinero" ? `**${fmtNumero(Number(s.premioValor))}** 🪙` : `**${s.premioNombre}**`);

function requisitosTexto(s) {
    const partes = [];
    if (s.rolId) partes.push(`rol <@&${s.rolId}>`);
    if (s.nivel > 0) partes.push(`nivel **${s.nivel}+**`);
    return partes.length ? partes.join(" · ") : "ninguno";
}

/** El mensaje del sorteo. `terminado` quita el botón y enseña los ganadores. */
function buildSorteo(s, { participantes = 0, ganadores = [], aviso = null, terminado = false } = {}) {
    const fin = Math.floor(s.fin / 1000);
    const embed = new EmbedBuilder()
        .setTitle(`🎁 Sorteo: ${s.premioNombre}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (terminado ? "El sorteo ha terminado." : "Pulsa el botón para entrar o salir. Se puede hasta que termine."),
        )
        .addFields(
            { name: "Premio", value: premioTexto(s), inline: true },
            { name: "Ganadores", value: String(s.ganadores), inline: true },
            { name: "Participantes", value: String(participantes), inline: true },
            { name: "Termina", value: terminado ? "Terminado" : `<t:${fin}:f> (<t:${fin}:R>)`, inline: true },
            { name: "Requisitos", value: requisitosTexto(s), inline: true },
        )
        .setColor(terminado ? 0x95a5a6 : 0xf1c40f)
        .setFooter({ text: `Sorteo #${s.id}` })
        .setTimestamp();
    if (terminado) {
        embed.addFields({
            name: "🏆 Ganadores",
            value: ganadores.length ? ganadores.map((g) => `<@${g.userId}>`).join(", ") : "Nadie cumplía los requisitos.",
        });
    }
    const components = [];
    if (!terminado && s.estado === "activo") {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`sorteo_entrar_${s.id}`).setLabel("🎟️ Entrar / Salir").setStyle(ButtonStyle.Primary),
            ),
        );
    }
    return { content: "", embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Lista para /sorteos. */
function buildLista(activos) {
    const embed = new EmbedBuilder()
        .setTitle("🎁 Sorteos activos")
        .setDescription(
            activos.length
                ? activos
                      .map((s) => `**#${s.id}** · ${s.premioNombre} · <#${s.channelId}> · termina <t:${Math.floor(s.fin / 1000)}:R>`)
                      .join("\n")
                : "No hay sorteos activos.",
        )
        .setColor(0xf1c40f);
    return { content: "", embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports = { premioTexto, requisitosTexto, buildSorteo, buildLista };
