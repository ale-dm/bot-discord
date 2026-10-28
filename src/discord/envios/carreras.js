// 🏇 Las carreras en Discord (#535): en cada servidor con canal de carreras, abrir y publicar la siguiente, avisar 2 minutos
// antes de la salida y, al llegar la hora, resolverla (el ganador y los pagos quedan guardados antes de animar nada), animarla
// editando el mensaje cada 3 segundos y anunciar quién gana. Una carrera que pilló el bot apagado se resuelve al arrancar,
// sin animación. Cron cada minuto.
const carreras = require("../../systems/carreras");
const { mensajeCarrera, fotogramas } = require("../../paneles/carrera");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("Carreras");
const PAUSA_MS = 3000;

const esperar = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function canal(client, id) {
    return id ? client.channels.fetch(id).catch(() => null) : null;
}

async function editar(client, c, payload) {
    const ch = await canal(client, c.channelId);
    if (!ch || !c.messageId) return;
    await ch.messages.edit(c.messageId, payload).catch((e) => log.debug(`No se pudo editar la carrera ${c.id}: ${e.message}`));
}

/** Publica la carrera abierta del servidor si es nueva. */
async function abrirSiFalta(client, guildId, ahora, azar) {
    const { canal: canalId } = carreras.ajustes(guildId);
    if (!canalId) return;
    const { carrera, nueva } = carreras.asegurarAbierta(guildId, canalId, { azar, ahora });
    if (!nueva) return;
    const ch = await canal(client, canalId);
    if (!ch?.send) return log.debug(`Sin canal de carreras en ${guildId}`);
    const m = await ch.send(mensajeCarrera(carrera));
    carreras.guardarMensaje(carrera.id, m.id);
}

/** Resuelve, anima (si se pide) y anuncia una carrera vencida. */
async function correr(client, id, { ahora, azar, animar, pausaMs }) {
    const r = carreras.resolver(id, { azar, ahora });
    if (!r) return false;
    const c = r.carrera;
    if (animar) {
        for (const posiciones of fotogramas(c.ganador, c.corredores.length, azar)) {
            await editar(client, c, mensajeCarrera(c, posiciones));
            await esperar(pausaMs);
        }
    }
    await editar(client, c, mensajeCarrera(c, null, r.ganadores));
    const g = c.corredores[c.ganador];
    const ch = await canal(client, c.channelId);
    const cobran = r.ganadores.length
        ? r.ganadores.map((x) => `<@${x.userId}> **${fmtNumero(x.premio)}** 🪙`).join(" · ")
        : r.apostado
          ? "nadie acertó"
          : "nadie apostó";
    await ch
        ?.send?.({
            content: `🏁 **Carrera #${c.id}**: gana ${g.emoji} **${g.nombre}** (×${String(g.cuota).replace(".", ",")}). ${cobran}.`,
            allowedMentions: { parse: [] },
        })
        .catch(() => {});
    return true;
}

/** Cron. `animar`: si la carrera es de ahora (no la que pilló el bot apagado). */
async function revisar(client, ahora = Date.now(), { azar = Math.random, pausaMs = PAUSA_MS } = {}) {
    let corridas = 0;
    for (const id of carreras.vencidas(ahora)) {
        try {
            const c = carreras.obtener(id);
            const animar = ahora - c.empieza < 2 * 60 * 1000;
            if (await correr(client, id, { ahora, azar, animar, pausaMs })) corridas++;
        } catch (e) {
            log.warn(`Falló la carrera ${id}: ${e.message}`);
        }
    }
    for (const c of carreras.porAvisar(ahora)) {
        const ch = await canal(client, c.channelId);
        await ch
            ?.send?.({ content: `🏇 **La carrera #${c.id} sale en 2 minutos.** ¡Últimas apuestas!`, allowedMentions: { parse: [] } })
            .catch(() => {});
    }
    for (const guildId of client.guilds?.cache?.keys?.() || []) {
        await abrirSiFalta(client, guildId, ahora, azar).catch((e) => log.warn(`No se pudo abrir la carrera de ${guildId}: ${e.message}`));
    }
    return corridas;
}

module.exports = { revisar, correr };
