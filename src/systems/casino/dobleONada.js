// Doble o nada (#462): tras ganar en un juego del casino se ofrece jugarse la ganancia a una tirada de 50 %. Aquí está la oferta
// de cada persona (en memoria, sin nada de Discord): la registra el cobro de una victoria (casinoTransactions.procesarGanancia) y
// se retira al usarla, al empezar otra partida o a los 10 minutos. Una oferta sirve una sola vez y no se encadena: el resultado
// de un doble o nada no ofrece otro. El cobro y la tirada están en juegos/casino/dobleONada.
const TTL_MS = 10 * 60 * 1000;
/** El nombre con el que se apunta en el casino la segunda ronda: una partida distinta a la que se ganó. */
const JUEGO = "doble_o_nada";
/** Probabilidad de ganar la segunda ronda. */
const PROBABILIDAD = 0.5;

const ofertas = new Map();

/**
 * Registra la oferta tras una victoria con `ganancia` neta (lo ganado por encima de la apuesta). Si esa persona ya tenía una
 * oferta viva del mismo juego (las dos manos ganadas de un blackjack con split), las ganancias se suman. La segunda ronda
 * de un doble o nada no genera oferta.
 */
function ofrecer(userId, juego, ganancia, { apuesta = 0, guildId = null, ahora = Date.now() } = {}) {
    if (juego === JUEGO || !(ganancia > 0)) return null;
    const previa = ofertas.get(userId);
    const viva = previa && previa.juego === juego && ahora - previa.creada <= TTL_MS;
    const nueva = { juego, apuesta, guildId, ganancia: (viva ? previa.ganancia : 0) + ganancia, creada: ahora };
    ofertas.set(userId, nueva);
    return nueva;
}

/** La oferta viva de `userId` para ese juego, o null (caducada, de otro juego o ya usada). */
function oferta(userId, juego, ahora = Date.now()) {
    const o = ofertas.get(userId);
    if (!o || o.juego !== juego) return null;
    if (ahora - o.creada > TTL_MS) {
        ofertas.delete(userId);
        return null;
    }
    return o;
}

/** Usa la oferta: la devuelve y la retira, así que no se puede usar dos veces. */
function tomar(userId, juego, ahora = Date.now()) {
    const o = oferta(userId, juego, ahora);
    if (o) ofertas.delete(userId);
    return o;
}

/** Retira la oferta de alguien (al empezar otra partida). */
function cancelar(userId) {
    ofertas.delete(userId);
}

module.exports = { JUEGO, PROBABILIDAD, TTL_MS, ofrecer, oferta, tomar, cancelar };
