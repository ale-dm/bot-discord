// 🎱 El bingo en Discord (#528): cantar las bolas (una cada 3 segundos, editando el mensaje de la sala) hasta la del bingo, que
// ya se decidió al empezar, y entonces pagar y anunciarlo. El cron (cada minuto) empieza las salas que han agotado la espera
// (o las cancela si no hay gente) y termina directamente las que se quedaron a medias por un reinicio.
const bingo = require("../../systems/bingo");
const { mensajeSala } = require("../../paneles/bingo");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("Bingo");
const PAUSA_MS = 3000;
/** Las partidas que se están cantando ahora en este proceso (para no confundirlas con huérfanas). */
const enJuego = new Set();

const esperar = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function editar(client, p, payload) {
    if (!p.channelId || !p.messageId) return;
    try {
        const canal = await client.channels.fetch(p.channelId);
        await canal.messages.edit(p.messageId, payload);
    } catch (e) {
        log.debug(`No se pudo editar el bingo ${p.id}: ${e.message}`);
    }
}

async function anunciar(client, p, r) {
    try {
        const canal = await client.channels.fetch(p.channelId);
        const texto = r.ganadores.map((g) => `<@${g.userId}> **${fmtNumero(g.premio)}** 🪙`).join(" · ");
        await canal.send({ content: `🎉 **¡Bingo!** en la sala #${p.id}: ${texto || "nadie"}.`, allowedMentions: { parse: [] } });
    } catch (e) {
        log.debug(`No se pudo anunciar el bingo ${p.id}: ${e.message}`);
    }
}

/** Termina, repinta y anuncia. */
async function cerrar(client, id) {
    const r = bingo.terminar(id);
    if (!r) return null;
    await editar(client, r.partida, mensajeSala(r.partida, r.partida.bola_ganadora, r.ganadores));
    await anunciar(client, r.partida, r);
    return r;
}

/** Canta las bolas de una partida que acaba de empezar y la termina. */
async function cantar(client, id, { pausaMs = PAUSA_MS } = {}) {
    if (enJuego.has(id)) return;
    enJuego.add(id);
    try {
        const p = bingo.obtener(id);
        for (let n = 1; n <= p.bola_ganadora; n++) {
            await esperar(pausaMs);
            await editar(client, p, mensajeSala(p, n));
        }
        await cerrar(client, id);
    } catch (e) {
        log.warn(`Falló el canto del bingo ${id}: ${e.message}`);
    } finally {
        enJuego.delete(id);
    }
}

/** Empieza una sala (o la cancela si no hay gente) y lanza el canto sin esperar a que acabe. */
async function arrancar(client, id, opciones = {}) {
    const r = bingo.empezar(id, opciones);
    if (r.ok === false) return r;
    await editar(client, r.partida, mensajeSala(r.partida));
    if (!r.cancelada) {
        const canto = cantar(client, id, opciones);
        if (opciones.esperarCanto) await canto;
    }
    return { ok: true, ...r };
}

/** Cron: salas sin espera y partidas huérfanas. */
async function revisar(client, ahora = Date.now(), opciones = {}) {
    for (const id of bingo.esperasVencidas(ahora)) {
        await arrancar(client, id, { ...opciones, ahora }).catch((e) => log.warn(`Falló empezar el bingo ${id}: ${e.message}`));
    }
    const maximo = bingo.BOLAS * PAUSA_MS + 60 * 1000;
    for (const id of bingo.jugandoDesde(maximo, ahora)) {
        if (!enJuego.has(id)) await cerrar(client, id);
    }
}

module.exports = { arrancar, cantar, cerrar, revisar };
