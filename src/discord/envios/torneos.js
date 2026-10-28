// 🏆 Los torneos de casino en Discord (#525): publicar el mensaje del torneo, repintarlo (la clasificación en directo, cada
// minuto mientras se juega) y anunciar cuándo empieza, si se cancela y quién gana. Cron cada minuto y al arrancar.
const torneos = require("../../systems/torneos");
const { mensajeTorneo, textoAnuncio } = require("../../paneles/torneo");
const { createLogger } = require("../../core/logger");

const log = createLogger("Torneos");

async function canalDe(client, t) {
    return t.channelId ? client.channels.fetch(t.channelId).catch(() => null) : null;
}

/** Publica el mensaje del torneo en su canal y lo apunta. */
async function publicar(client, t) {
    const canal = await canalDe(client, t);
    if (!canal?.send) return { ok: false, motivo: "No encuentro el canal del torneo o no puedo escribir en él." };
    const m = await canal.send(mensajeTorneo(t));
    torneos.guardarMensaje(t.id, canal.id, m.id);
    return { ok: true };
}

async function repintar(client, t) {
    if (!t.channelId || !t.messageId) return;
    try {
        const canal = await client.channels.fetch(t.channelId);
        await canal.messages.edit(t.messageId, mensajeTorneo(t));
    } catch (e) {
        log.debug(`No se pudo repintar el torneo ${t.id}: ${e.message}`);
    }
}

async function anunciar(client, t, texto) {
    const canal = await canalDe(client, t);
    await canal?.send?.({ content: texto, allowedMentions: { parse: [] } }).catch((e) => log.debug(e.message));
}

/** Cron: cambia de fase lo que toque y repinta la clasificación de los que están en juego. */
async function revisar(client, ahora = Date.now()) {
    let cambios = 0;
    for (const id of torneos.pendientes(ahora)) {
        try {
            const r = torneos.avanzar(id, ahora);
            if (!r) continue;
            cambios++;
            log.info(`Torneo ${id}: ${r.paso}`);
            await repintar(client, r.torneo);
            await anunciar(client, r.torneo, textoAnuncio(r));
        } catch (e) {
            log.warn(`Falló el torneo ${id}: ${e.message}`);
        }
    }
    for (const t of torneos.enCurso()) await repintar(client, t);
    return cambios;
}

module.exports = { publicar, repintar, revisar };
