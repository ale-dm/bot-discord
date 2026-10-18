// Adaptador de los recuerdos automáticos del Duende (#472): manda a los admins el DM con la propuesta (y sus botones) y,
// cuando caduca, se los quita. La lógica (buffers, Gemini, decisiones) vive en src/systems/duende/recuerdosAuto.
const db = require("../../core/db");
const recuerdos = require("../../systems/duende/recuerdosAuto");
const { mensajePropuesta } = require("../mensajes/recuerdos");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Recuerdos");

/** Un DM a cada admin con la propuesta y los dos botones. Un admin que tiene los DMs cerrados no para a los demás. */
async function avisarAdmins(client, propuesta) {
    const { embed, fila } = mensajePropuesta(propuesta);
    for (const adminId of recuerdos.adminsDe(propuesta.guildId)) {
        try {
            const usuario = await client.users.fetch(adminId);
            const dm = await usuario.send({ embeds: [embed], components: [fila], allowedMentions: { parse: [] } });
            // Se apunta el mensaje para quitarle los botones si la propuesta caduca (#390).
            if (dm?.id) {
                db.prepare(
                    "INSERT OR REPLACE INTO duende_recuerdos_dms (propuesta_id, userId, canalId, mensajeId) VALUES (?, ?, ?, ?)",
                ).run(propuesta.id, String(adminId), String(dm.channelId ?? ""), String(dm.id));
            }
        } catch (e) {
            log.debug(`No se pudo avisar a ${adminId} del recuerdo propuesto: ${e.message}`);
        }
    }
}

/** Analiza (a través del sistema) y, si hay propuesta, avisa a los admins. */
async function analizar(client, guildId, usuario, textos, deps = {}) {
    const propuesta = await recuerdos.analizar(guildId, usuario, textos, deps);
    if (propuesta) await avisarAdmins(client, propuesta);
    return propuesta;
}

/**
 * Mira un mensaje: deja que el sistema acumule y decida y, si toca llamar a Gemini, cuando salga la propuesta avisa a
 * los admins. No bloquea nada (va en segundo plano).
 */
function observar(message, deps = {}) {
    const pendiente = recuerdos.observar(message, deps);
    if (!pendiente) return;
    pendiente
        .then((propuesta) => propuesta && avisarAdmins(message.client, propuesta))
        .catch((e) => log.warn(`No se pudo analizar la conversación del servidor ${message.guildId}: ${e.message}`));
}

/** Caduca las propuestas vencidas y quita los botones de sus DMs (#390). */
async function caducarPendientes(client, ahora = Date.now()) {
    const { total, dms } = recuerdos.caducarPendientes(ahora);
    for (const dm of dms) {
        try {
            const canal = await (await client.users.fetch(dm.userId)).createDM();
            const mensaje = await canal.messages.fetch(dm.mensajeId);
            await mensaje.edit({ content: "⌛ Esta propuesta caducó sin decidirse.", components: [] });
        } catch (e) {
            log.debug(`No se pudieron quitar los botones del DM de la propuesta ${dm.propuestaId}: ${e.message}`);
        }
    }
    if (total) log.info(`${total} propuestas de recuerdo caducadas (más de ${recuerdos.DIAS_CADUCA} días sin decidir)`);
    return total;
}

module.exports = { observar, analizar, avisarAdmins, caducarPendientes };
