// Adaptador del resumen semanal para admins (#472): comprueba si toca, pide los destinatarios a las alertas y manda el
// DM con el embed. Los datos los arma src/systems/resumenAdmin.
const { HORA, construir, semanaEnviada, apuntarSemana, marcarEnviado } = require("../../systems/resumenAdmin");
const alertas = require("../../systems/alertas");
const { sendDm } = require("../../systems/avisosDm");
const { momentoMadrid: momento } = require("../../core/zonaMadrid");
const { embedResumen } = require("../mensajes/resumenSemanal");
const { createLogger } = require("../../core/logger");

const log = createLogger("Resumen");

/**
 * Cron (cada hora de los lunes) y arranque: si es lunes desde las 09:00 (Madrid) y esta semana no se ha mandado, lo
 * manda por DM a quien recibe las alertas. @returns {Promise<number>} DMs enviados
 */
async function enviarSiToca(client, ahora = Date.now(), opciones = {}) {
    const { dia, hora, lunes } = momento(ahora);
    if (!lunes || hora < HORA || semanaEnviada() === dia) return 0;
    const ids = alertas.destinatarios();
    if (!ids.length) {
        log.info("Resumen semanal sin destinatarios (alertas desactivadas)");
        return 0;
    }
    const embed = embedResumen(construir(ahora, opciones));
    let enviados = 0;
    for (const id of ids) {
        if (await sendDm(client, id, { embeds: [embed] })) enviados++;
    }
    apuntarSemana(dia);
    marcarEnviado();
    log.info(`Resumen semanal enviado a ${enviados}/${ids.length} admins`);
    return enviados;
}

module.exports = { enviarSiToca };
