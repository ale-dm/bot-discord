// 📅 Recordatorios del calendario (#540): cada minuto, en cada servidor con canal y minutos configurados, avisa de los eventos
// que empiezan pronto. Cada evento se marca antes de mandar (así un reinicio o dos pasadas a la vez no lo repiten) y, si el
// envío falla, se desmarca para el siguiente intento.
const calendario = require("../../systems/calendario");
const { recordatorio } = require("../../paneles/calendario");
const { createLogger } = require("../../core/logger");

const log = createLogger("Calendario");

/** @returns {Promise<number>} recordatorios mandados */
async function recordar(client, ahora = Date.now()) {
    let enviados = 0;
    for (const guild of client.guilds?.cache?.values?.() ?? []) {
        const pendientes = calendario.pendientesDeRecordar(guild.id, ahora);
        if (!pendientes.length) continue;
        const canalId = calendario.ajustes(guild.id).canal;
        const canal = guild.channels?.cache?.get(canalId) || (await guild.channels?.fetch?.(canalId).catch(() => null));
        if (!canal?.isTextBased?.()) {
            log.warn(`El canal de recordatorios ${canalId} no existe o no es de texto en ${guild.id}`);
            continue;
        }
        for (const e of pendientes) {
            if (!calendario.marcarRecordado(guild.id, e.clave, ahora)) continue;
            try {
                await canal.send(recordatorio(e));
                enviados++;
            } catch (err) {
                calendario.desmarcarRecordado(guild.id, e.clave);
                log.warn(`No se pudo mandar el recordatorio de ${e.clave} en ${guild.id}: ${err.message}`);
            }
        }
    }
    return enviados;
}

module.exports = { recordar };
