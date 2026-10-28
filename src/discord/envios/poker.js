// 🃏 El póker en Discord (#531): lleva en memoria la mano en juego de cada mesa (la mano y el temporizador del turno), aplica
// las acciones, pasa el turno solo a los 45 segundos (pasa si puede y, si no, se retira), guarda las fichas y las estadísticas
// al acabar cada mano y reparte la siguiente si quedan 2 con fichas. El cron empieza las mesas que agotan la espera o cierra
// las vacías o inactivas devolviendo las fichas; al arrancar, cierra las que cortó un reinicio. Nada queda a medias: los
// temporizadores se limpian al terminar la mano o cerrar la mesa.
const mesas = require("../../systems/poker/mesas");
const mano = require("../../systems/poker/mano");
const { mensajeMesa, textoResultado } = require("../../paneles/poker");
const { createLogger } = require("../../core/logger");

const log = createLogger("Poker");
const TURNO_MS = 45 * 1000;
const PAUSA_ENTRE_MANOS_MS = 6000;
/** mesaId → { mano, timer, inicio: Map(userId → fichas al empezar), tiempos: Set(userId) } */
const enJuego = new Map();

const opcionesPorDefecto = { turnoMs: TURNO_MS, pausaMs: PAUSA_ENTRE_MANOS_MS, rng: Math.random, seguir: true };

async function editar(client, mesa, payload) {
    if (!mesa.channelId || !mesa.messageId) return;
    try {
        const canal = await client.channels.fetch(mesa.channelId);
        await canal.messages.edit(mesa.messageId, payload);
    } catch (e) {
        log.debug(`No se pudo editar la mesa ${mesa.id}: ${e.message}`);
    }
}

const repintar = (client, mesaId, aviso = "") =>
    editar(client, mesas.obtener(mesaId), mensajeMesa(mesas.obtener(mesaId), enJuego.get(Number(mesaId))?.mano, aviso));

function limpiar(mesaId) {
    const r = enJuego.get(Number(mesaId));
    if (r?.timer) clearTimeout(r.timer);
    enJuego.delete(Number(mesaId));
}

/** Guarda la mano terminada, la anuncia en el mensaje y, si se puede, reparte la siguiente. */
async function finalizar(client, mesaId, opciones) {
    const r = enJuego.get(Number(mesaId));
    if (!r) return;
    const m = r.mano;
    limpiar(mesaId);
    mesas.guardarMano(
        mesaId,
        m.jugadores.map((j) => ({
            userId: j.userId,
            fichas: j.fichas,
            ganado: j.fichas - r.inicio.get(j.userId),
            agotoTiempo: r.tiempos.has(j.userId),
        })),
    );
    await repintar(client, mesaId, textoResultado(m));
    if (!opciones.seguir) return;
    setTimeout(() => {
        if (mesas.jugadoresDeMano(mesaId).length >= mesas.MIN_JUGADORES)
            iniciarMano(client, mesaId, opciones).catch((e) => log.warn(e.message));
    }, opciones.pausaMs);
}

/** Pone el temporizador del turno de quien tiene que hablar. */
function programarTurno(client, mesaId, opciones) {
    const r = enJuego.get(Number(mesaId));
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => {
        const a = mano.acciones(r.mano);
        if (!a) return;
        r.tiempos.add(a.userId);
        mano.actuarPorTiempo(r.mano);
        despuesDeActuar(client, mesaId, opciones).catch((e) => log.warn(e.message));
    }, opciones.turnoMs);
}

async function despuesDeActuar(client, mesaId, opciones) {
    const r = enJuego.get(Number(mesaId));
    if (!r) return;
    if (r.mano.fin) return finalizar(client, mesaId, opciones);
    programarTurno(client, mesaId, opciones);
    return repintar(client, mesaId);
}

/** Reparte una mano nueva con los que tienen fichas. @returns {Promise<boolean>} si se ha repartido */
async function iniciarMano(client, mesaId, opciones = {}) {
    const o = { ...opcionesPorDefecto, ...opciones };
    if (enJuego.has(Number(mesaId))) return false;
    const lista = mesas.jugadoresDeMano(mesaId);
    if (lista.length < mesas.MIN_JUGADORES) return false;
    const boton = mesas.empezarMano(mesaId, lista.length);
    const m = mano.nuevaMano({ asientos: lista.map((a) => ({ userId: a.userId, fichas: a.fichas })), boton, ...mesas.CIEGAS, rng: o.rng });
    enJuego.set(Number(mesaId), { mano: m, timer: null, inicio: new Map(lista.map((a) => [a.userId, a.fichas])), tiempos: new Set() });
    await despuesDeActuar(client, mesaId, o);
    return true;
}

/** Una acción de un jugador desde los botones. @returns {Promise<{ ok: boolean, motivo?: string }>} */
async function actuar(client, mesaId, userId, accion, opciones = {}) {
    const r = enJuego.get(Number(mesaId));
    if (!r) return { ok: false, motivo: "No hay ninguna mano en juego en esta mesa." };
    const res = mano.actuar(r.mano, userId, accion);
    if (!res.ok) return res;
    r.tiempos.delete(String(userId));
    await despuesDeActuar(client, mesaId, { ...opcionesPorDefecto, ...opciones });
    return { ok: true };
}

/** ¿Está jugando la mano en curso? (para no dejar que se levante a media mano). */
function enMano(mesaId, userId) {
    const r = enJuego.get(Number(mesaId));
    return Boolean(r && !r.mano.fin && r.mano.jugadores.some((j) => j.userId === String(userId)));
}

/** Las cartas de un jugador en la mano en curso, o null. */
function cartasDe(mesaId, userId) {
    const j = enJuego.get(Number(mesaId))?.mano.jugadores.find((x) => x.userId === String(userId));
    return j ? j.cartas : null;
}

/** Cierra la mesa (devolviendo las fichas) y la repinta. */
async function cerrarMesa(client, mesaId, motivo) {
    limpiar(mesaId);
    const m = mesas.cerrar(mesaId, motivo);
    if (m) await editar(client, m, mensajeMesa(m));
    return m;
}

/** Cron: empieza las mesas que agotan la espera inicial con gente; cierra las vacías o sin manos en 10 minutos. */
async function revisar(client, ahora = Date.now(), opciones = {}) {
    for (const id of mesas.esperasVencidas(ahora)) {
        if (enJuego.has(id)) continue;
        const m = mesas.obtener(id);
        const conGente = mesas.jugadoresDeMano(id).length >= mesas.MIN_JUGADORES;
        if (m.manos === 0 && conGente) await iniciarMano(client, id, opciones);
        else await cerrarMesa(client, id, m.manos === 0 ? "no se llenó la mesa" : "mesa inactiva");
    }
}

/** Al arrancar: las mesas que dejó abiertas un reinicio se cierran devolviendo las fichas. */
function alArrancar() {
    return mesas.cerrarHuerfanas();
}

module.exports = { TURNO_MS, iniciarMano, actuar, enMano, cartasDe, cerrarMesa, revisar, alArrancar, repintar, limpiar, enJuego };
