// 🔁 El botón de revancha del mensaje de un duelo resuelto (#318): propone el mismo duelo al otro jugador en un mensaje nuevo, y el
// duelo de origen deja de ofrecerla. Las reglas están en systems/retos/revancha.
const { MessageFlags } = require("discord.js");
const retos = require("../../systems/retos");
const paneles = require("../../paneles/retos");

/** retos_revancha_{id}: quien lo pulsa (uno de los dos) reta al otro. */
async function botonRevancha(i, retoId) {
    const r = retos.pedirRevancha(retoId, i.user.id, { guildId: i.guildId, channelId: i.channelId });
    if (!r.ok) return i.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
    const rival = r.reto.rival;
    await i.update(paneles.mensajeReto(r.origen)); // el duelo ya no ofrece la revancha
    const mensaje = await i.followUp({
        content: `🔁 <@${rival}>, <@${i.user.id}> te pide la revancha.`,
        ...paneles.mensajeReto(r.reto),
        allowedMentions: { users: [rival] },
    });
    if (mensaje?.id) retos.guardarMensaje(r.reto.id, mensaje.channelId || i.channelId, mensaje.id);
}

module.exports = { botonRevancha };
