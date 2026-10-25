// ⚠️ Lo que el aviso de moderación (#542) manda por Discord: el DM al avisado con el motivo, la línea en el canal de log de
// moderación (si hay) y, al cruzar un umbral, el aviso a los admins con la medida sugerida. Todo best-effort: un DM cerrado o
// un canal borrado no deshacen el aviso, que ya está apuntado y auditado.
const moderacion = require("../../systems/moderacion");
const guildSettings = require("../../systems/guildSettings");
const avisosDm = require("../../systems/avisosDm");
const { createLogger } = require("../../core/logger");

const log = createLogger("Moderacion");
const sinMenciones = { parse: [] };

/** El DM al avisado. @returns {Promise<boolean>} si le llegó */
function avisarAlUsuario(client, guild, { userId, motivo, vigentes }) {
    const plural = vigentes === 1 ? "" : "s";
    return avisosDm.sendDm(client, userId, {
        content:
            `⚠️ Has recibido un aviso del staff de **${guild.name}**.\n**Motivo:** ${motivo}\n` +
            `Llevas **${vigentes}** strike${plural} vigente${plural} ` +
            `(cada uno caduca a los ${moderacion.ajustes(guild.id).caducidadDias} días).`,
        allowedMentions: sinMenciones,
    });
}

/** Escribe en el canal de log de moderación, si está configurado. @returns {Promise<boolean>} si se escribió */
async function apuntarEnLog(guild, texto) {
    const canalId = moderacion.ajustes(guild.id).canalLog;
    if (!canalId) return false;
    const canal = guild.channels?.cache?.get(canalId) || (await guild.channels?.fetch?.(canalId).catch(() => null));
    if (!canal?.isTextBased?.()) {
        log.warn(`El canal de log de moderación ${canalId} no existe o no es de texto en ${guild.id}`);
        return false;
    }
    try {
        await canal.send({ content: texto, allowedMentions: sinMenciones });
        return true;
    } catch (e) {
        log.warn(`No se pudo escribir en el log de moderación de ${guild.id}: ${e.message}`);
        return false;
    }
}

/** Al cruzar un umbral: DM a los admins de las alertas con la medida sugerida. @returns {Promise<number>} DMs enviados */
async function avisarAdmins(client, guild, { userId, vigentes, umbral }) {
    const ids = guildSettings.parseCsvIds(guildSettings.getSettings(guild.id).alertas.admin_ids);
    const texto =
        `🚨 **Moderación en ${guild.name}**: <@${userId}> llega a **${vigentes}** strikes vigentes.\n` +
        `Medida sugerida: **${umbral.texto}**. El bot no la aplica: decide el staff.`;
    let enviados = 0;
    for (const id of ids) if (await avisosDm.sendDm(client, id, { content: texto, allowedMentions: sinMenciones })) enviados++;
    return enviados;
}

/** Todo lo que sale de un aviso ya apuntado. @returns {Promise<{ dm: boolean, admins: number }>} */
async function notificar(client, guild, { userId, staffId, motivo, resultado }) {
    const dm = await avisarAlUsuario(client, guild, { userId, motivo, vigentes: resultado.vigentes });
    await apuntarEnLog(
        guild,
        `⚠️ <@${staffId}> avisa a <@${userId}> (strike #${resultado.id}, **${resultado.vigentes}** vigentes): ${motivo}` +
            (resultado.umbral ? `\nMedida sugerida: **${resultado.umbral.texto}**.` : "") +
            (dm ? "" : "\n_(No se le pudo mandar el DM.)_"),
    );
    const admins = resultado.umbral
        ? await avisarAdmins(client, guild, { userId, vigentes: resultado.vigentes, umbral: resultado.umbral })
        : 0;
    return { dm, admins };
}

module.exports = { notificar, apuntarEnLog };
