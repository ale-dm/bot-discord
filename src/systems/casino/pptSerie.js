// Piedra, papel o tijera al mejor de tres contra el Duende (#457): gana quien gana dos manos, o quien lleva más tras la tercera
// (con las mismas manos ganadas, empate: se recupera la apuesta). La apuesta se cobra una sola vez al empezar y se fija: no
// cambia entre manos. Se paga al final como una victoria suelta (×2), se pierde o se devuelve. Una serie sin tocar 15 minutos se
// cierra y se devuelve la apuesta. El estado vive en memoria; el dinero cobrado se apunta en activeGames, así que un reinicio
// del bot también lo devuelve. juegos/casino/pptSerie pinta los mensajes.
const activeGames = require("../activeGames");
const dinero = require("../dinero");
const { procesarGanancia, procesarPerdida } = require("../casinoTransactions");
const { jugadaDuende, resolverJugada } = require("./ppt");
const { createLogger } = require("../../core/logger");

const log = createLogger("Casino");

/** El nombre con el que la serie se apunta como partida en curso (lo que se reembolsa si el bot se reinicia). */
const JUEGO_ACTIVO = "ppt (mejor de 3)";
const MAX_MANOS = 3;
const VICTORIAS = 2;

const series = new Map();

/** Empieza una serie con la apuesta ya cobrada. Sustituye a la anterior de esa persona, que no puede estar en curso. */
function iniciar(userId, guildId, apuesta, ahora = Date.now()) {
    const serie = { userId, guildId: guildId || null, apuesta, manos: [], ultimaAccion: ahora };
    series.set(userId, serie);
    activeGames.registrar(userId, JUEGO_ACTIVO, guildId, apuesta);
    return serie;
}

/** La serie en curso de alguien, o null. */
const de = (userId) => series.get(userId) || null;

/** Manos ganadas y perdidas. */
function marcador(serie) {
    return {
        ganadas: serie.manos.filter((m) => m.tipo === "victoria").length,
        perdidas: serie.manos.filter((m) => m.tipo === "derrota").length,
    };
}

/** Cómo acaba la serie, o null si sigue: dos manos ganadas o perdidas, o la tercera mano (gana quien lleva más; si no, empate). */
function resultadoFinal(serie) {
    const { ganadas, perdidas } = marcador(serie);
    if (ganadas >= VICTORIAS) return "victoria";
    if (perdidas >= VICTORIAS) return "derrota";
    if (serie.manos.length < MAX_MANOS) return null;
    return ganadas > perdidas ? "victoria" : perdidas > ganadas ? "derrota" : "empate";
}

/** Juega una mano: la jugada de quien juega contra la del Duende. @returns {{ serie: object, mano: object, final: string | null }} */
function jugarMano(userId, jugada, { ahora = Date.now(), jugadaDelDuende = jugadaDuende() } = {}) {
    const serie = series.get(userId);
    const mano = { usuario: jugada, duende: jugadaDelDuende, tipo: resolverJugada(jugada, jugadaDelDuende) };
    serie.manos.push(mano);
    serie.ultimaAccion = ahora;
    return { serie, mano, final: resultadoFinal(serie) };
}

/**
 * Cierra la serie y cobra: la victoria paga el doble de la apuesta (lo mismo que una victoria suelta), el empate la devuelve y
 * la derrota la pierde (ya estaba descontada). Cuenta como una sola partida de ppt en el historial del casino.
 * @returns {{ exito: boolean, ganancia: number }}
 */
function liquidar(userId, final) {
    const serie = series.get(userId);
    series.delete(userId);
    activeGames.cerrar(userId, JUEGO_ACTIVO);
    const { ganadas, perdidas } = marcador(serie);
    const descripcion = `PPT al mejor de 3: ${ganadas}-${perdidas} (${final}), apuesta ${serie.apuesta}`;
    const detalle = { modo: "mejor_de_3", manos: serie.manos, guildId: serie.guildId };
    if (final === "derrota") return { exito: procesarPerdida(userId, "ppt", serie.apuesta, descripcion, detalle), ganancia: 0 };
    const ganancia = final === "victoria" ? serie.apuesta * 2 : serie.apuesta;
    return { exito: procesarGanancia(userId, "ppt", serie.apuesta, ganancia, descripcion, detalle), ganancia };
}

/**
 * Una serie sin tocar 15 minutos se cierra y se devuelve la apuesta (cron de partidas abandonadas).
 * @returns {number} series cerradas
 */
function limpiarAbandonadas(ahora = Date.now()) {
    let cerradas = 0;
    for (const [userId, serie] of series) {
        if (ahora - serie.ultimaAccion <= activeGames.ABANDON_MS) continue;
        abandonar(userId);
        cerradas++;
    }
    return cerradas;
}

/** Cierra la serie de alguien devolviéndole la apuesta (abandonada, o sustituida por otra). */
function abandonar(userId) {
    const serie = series.get(userId);
    if (!serie) return false;
    series.delete(userId);
    activeGames.cerrar(userId, JUEGO_ACTIVO);
    dinero.pagar(userId, serie.apuesta);
    dinero.apuntar(userId, "casino", "Reembolso: PPT al mejor de 3 abandonado", serie.apuesta);
    log.info(`PPT al mejor de 3 de ${userId} abandonado: devueltas ${serie.apuesta} monedas`);
    return true;
}

module.exports = {
    JUEGO_ACTIVO,
    MAX_MANOS,
    VICTORIAS,
    iniciar,
    de,
    marcador,
    resultadoFinal,
    jugarMano,
    liquidar,
    limpiarAbandonadas,
    abandonar,
};
