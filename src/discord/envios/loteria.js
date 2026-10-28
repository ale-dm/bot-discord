// 🎟️ La lotería semanal en Discord (#524): celebrar los sorteos que tocan (cron cada 5 minutos y al arrancar, así un sorteo
// que pilló el bot apagado se celebra al volver, como atrasado), anunciar el resultado en el canal de la lotería y avisar por
// DM a quien gana. Lo de Discord es best-effort: el sorteo y los pagos ya están hechos aunque falle el anuncio.
const loteria = require("../../systems/loteria");
const avisosDm = require("../../systems/avisosDm");
const { textoResultado } = require("../../paneles/loteria");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("Loteria");
/** Si se sortea más de una hora tarde (el bot estaba apagado), el anuncio lo dice. */
const RETRASO_AVISO_MS = 60 * 60 * 1000;

async function anunciar(client, r, atrasado) {
    const canalId = loteria.ajustes(r.sorteo.guildId).canal;
    if (!canalId) return;
    try {
        const canal = await client.channels.fetch(canalId);
        await canal.send({ content: textoResultado(r, { atrasado }), allowedMentions: { parse: [] } });
    } catch (e) {
        log.debug(`No se pudo anunciar el sorteo ${r.sorteo.id}: ${e.message}`);
    }
}

async function avisarGanadores(client, r) {
    for (const g of r.ganadores) {
        await avisosDm.enviarAviso(client, g.userId, "loteria", {
            content: `🎟️ **¡Te ha tocado la lotería!** Combinación ${r.combinacion}: ganas **${fmtNumero(g.premio)}** 🪙, ya en tu efectivo.`,
        });
    }
}

/** Celebra los sorteos cuya hora ya ha llegado. @returns {Promise<number>} cuántos se han celebrado */
async function revisar(client, ahora = Date.now(), { azar = Math.random } = {}) {
    let celebrados = 0;
    for (const s of loteria.vencidos(ahora)) {
        try {
            const r = loteria.sortear(s.id, { azar, ahora });
            if (!r) continue;
            celebrados++;
            log.info(`Lotería ${s.id} (${s.guildId}): ${r.combinacion}, ${r.ganadores.length} acertantes, bote ${r.total}`);
            await anunciar(client, r, ahora - s.sorteo_en > RETRASO_AVISO_MS);
            await avisarGanadores(client, r);
        } catch (e) {
            log.warn(`Falló el sorteo de la lotería ${s.id}: ${e.message}`);
        }
    }
    return celebrados;
}

module.exports = { revisar };
