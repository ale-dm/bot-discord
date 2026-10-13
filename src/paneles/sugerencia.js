// 💡 El mensaje de cada sugerencia (#428) con su marcador y su estado, repintarlo en su canal y avisar del resultado por DM al
// autor. Las reglas están en systems/sugerencias; el formulario y los botones de voto, en commands/general/sugerencia.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const sugerencias = require("../systems/sugerencias");
const avisosDm = require("../systems/avisosDm");
const { createLogger } = require("../core/logger");

const log = createLogger("Sugerencias");

const COLOR = { pendiente: 0xf1c40f, aceptada: 0x2ecc71, descartada: 0xe74c3c };

/** El mensaje público de una sugerencia: su texto, quién la envió, su estado y el marcador con los botones de voto. */
function mensajeSugerencia(s, marcador = sugerencias.marcador(s.id)) {
    const resuelta = s.estado !== "pendiente";
    const embed = new EmbedBuilder()
        .setTitle(`💡 Sugerencia #${s.id}`)
        .setColor(COLOR[s.estado] || COLOR.pendiente)
        .setDescription(`${s.texto}\n\n**Enviada por** <@${s.userId}>\n**Estado:** ${sugerencias.ESTADOS[s.estado] || s.estado}`)
        .setFooter({ text: "Vota con 👍 o 👎: puedes cambiar tu voto" });
    if (resuelta) {
        embed.addFields({ name: "Decisión", value: `${s.motivo || "Sin motivo."}\nPor <@${s.resuelta_por}>` });
    }
    const boton = (voto, etiqueta, estilo) =>
        new ButtonBuilder().setCustomId(`sugerencia_voto_${s.id}_${voto}`).setLabel(etiqueta).setStyle(estilo).setDisabled(resuelta);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                boton("up", `👍 ${marcador.favor}`, ButtonStyle.Success),
                boton("down", `👎 ${marcador.contra}`, ButtonStyle.Danger),
            ),
        ],
        allowedMentions: { parse: [] },
    };
}

/** Repinta el mensaje de la sugerencia en su canal (best-effort: si se borró o no hay permisos, se sigue). */
async function repintar(client, s) {
    if (!s.channelId || !s.messageId) return false;
    try {
        const canal = await client.channels.fetch(s.channelId);
        await canal.messages.edit(s.messageId, mensajeSugerencia(s));
        return true;
    } catch (e) {
        log.debug(`No se pudo actualizar el mensaje de la sugerencia ${s.id}: ${e.message}`);
        return false;
    }
}

/** Le cuenta al autor, por DM, lo que se ha decidido de su sugerencia (con el motivo si lo hay). Respeta /avisos. */
async function avisarResultado(client, s) {
    const decision = s.estado === "aceptada" ? "✅ **aceptada**" : "❌ **descartada**";
    const texto = `💡 Tu sugerencia #${s.id} ha sido ${decision}.\n> ${s.texto.slice(0, 300)}${s.motivo ? `\nMotivo: ${s.motivo}` : ""}`;
    return avisosDm.enviarAviso(client, s.userId, "sugerencia", texto);
}

module.exports = { mensajeSugerencia, repintar, avisarResultado };
