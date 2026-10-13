// DM de los retos: que te toca jugar en un duelo (#452) y que un reto pendiente caduca pronto (#439). Pasan por /avisos
// (tipo «retos»): quien los tiene apagados no los recibe, y con los DM cerrados solo queda en el log.
const retos = require("../../systems/retos");
const avisosDm = require("../../systems/avisosDm");

/** El enlace al mensaje público de un reto (para los DM), o null si no se sabe dónde está. */
const enlaceReto = (reto) =>
    reto.guildId && reto.channelId && reto.messageId
        ? `https://discord.com/channels/${reto.guildId}/${reto.channelId}/${reto.messageId}`
        : null;

/**
 * Avisa por DM a quien le toca jugar en un duelo (#452) tras la jugada de `quien`: una sola vez por persona y partida, y
 * nunca si la jugada ha resuelto el duelo. Respeta /avisos; con los DM cerrados solo queda en el log.
 */
async function avisarTurno(client, retoId, quien) {
    const aviso = retos.avisoDeTurno(retoId, quien);
    if (!aviso) return false;
    const enlace = enlaceReto(aviso.reto);
    return avisosDm.enviarAviso(
        client,
        aviso.userId,
        "retos",
        `⚔️ <@${quien}> ya ha jugado en vuestro **${retos.descripcion(aviso.reto)}**: te toca.${enlace ? ` ${enlace}` : ""}`,
    );
}

/** Recuerda al rival de cada reto pendiente a mitad de plazo que caduca y que puede aceptarlo o rechazarlo (#439). */
async function enviarRecordatorios(client, lista) {
    for (const reto of lista) {
        const caduca = Math.floor(reto.expira_en / 1000);
        const enlace = enlaceReto(reto);
        await avisosDm.enviarAviso(
            client,
            reto.rival,
            "retos",
            `⏰ <@${reto.creador}> te retó a **${retos.descripcion(reto)}** por **${reto.cantidad.toLocaleString("es")}** 🪙 y caduca <t:${caduca}:R> (<t:${caduca}:f>). ` +
                `Puedes aceptarlo o rechazarlo.${enlace ? ` ${enlace}` : ""}`,
        );
    }
}

module.exports = { enlaceReto, avisarTurno, enviarRecordatorios };
