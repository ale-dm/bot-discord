// 🤝 Los préstamos entre jugadores en Discord (#520): el DM de la propuesta (con sus botones), el aviso a quien presta cuando
// la aceptan o la rechazan, y el cron (cada 10 minutos y al arrancar) que cobra los vencidos, reintenta las deudas, caduca
// las propuestas y avisa a las dos partes un día antes del vencimiento y cuando un préstamo pasa a deuda.
const prestamos = require("../../systems/prestamosJugadores");
const avisosDm = require("../../systems/avisosDm");
const { dmPropuesta } = require("../../paneles/prestamosJugadores");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("PrestamosJugadores");

const avisar = (client, userId, content) =>
    avisosDm.enviarAviso(client, userId, "prestamo_jugador", { content, allowedMentions: { parse: [] } });
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/** Manda la propuesta por DM a quien la recibe. @returns {Promise<boolean>} si llegó */
async function enviarPropuesta(client, p) {
    if (avisosDm.silenciado(p.prestatario, "prestamo_jugador")) return false;
    return (await avisosDm.intentarDm(client, p.prestatario, dmPropuesta(p))) === "ok";
}

/** Avisa a quien presta de que han aceptado o rechazado su propuesta. */
async function avisarRespuesta(client, p) {
    const texto =
        p.estado === "activo"
            ? `🤝 <@${p.prestatario}> ha aceptado tu préstamo #${p.id}: le has pasado **${fmtNumero(p.cantidad)}** 🪙 del banco. Vence ${ts(p.vence_en)}.`
            : `🤝 <@${p.prestatario}> ha rechazado tu préstamo #${p.id}.`;
    await avisar(client, p.prestamista, texto);
}

async function avisarCobro(client, r) {
    const p = r.prestamo;
    if (r.cobrado > 0) {
        await avisar(
            client,
            p.prestamista,
            `🤝 Cobrados **${fmtNumero(r.cobrado)}** 🪙 del préstamo #${p.id} a <@${p.prestatario}> (al banco).`,
        );
    }
    if (r.pasaADeuda) {
        const texto = `del préstamo #${p.id}: faltan **${fmtNumero(p.falta)}** 🪙. Se seguirá cobrando solo.`;
        await avisar(client, p.prestatario, `🔴 Ha vencido y no te llegaba para pagarlo todo ${texto}`);
        await avisar(client, p.prestamista, `🔴 <@${p.prestatario}> no ha podido pagarlo todo ${texto}`);
    }
}

/** Cron. @returns {Promise<number>} cuántos préstamos han cambiado */
async function revisar(client, ahora = Date.now()) {
    const r = prestamos.revisar(ahora);
    for (const c of r.cobros) await avisarCobro(client, c).catch((e) => log.debug(e.message));
    for (const p of r.avisar) {
        const texto = `el préstamo #${p.id} vence ${ts(p.vence_en)}: faltan **${fmtNumero(p.falta)}** 🪙.`;
        await avisar(client, p.prestatario, `⏰ Te recuerdo que ${texto} Si no lo pagas antes, se cobrará solo.`);
        await avisar(client, p.prestamista, `⏰ Tu ${texto.replace("el préstamo", "préstamo")}`);
    }
    if (r.cobros.length || r.caducadas)
        log.info(`Préstamos entre jugadores: ${r.cobros.length} cobros, ${r.caducadas} propuestas caducadas`);
    return r.cobros.length + r.caducadas;
}

module.exports = { enviarPropuesta, avisarRespuesta, revisar };
