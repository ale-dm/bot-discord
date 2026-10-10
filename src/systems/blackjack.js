// Reglas del blackjack sin nada de Discord ni de dinero: baraja de 4 mazos, valor de una mano (ases
// como 1 u 11), blackjack natural y cada jugada (pedir, plantarse, doblar, separar), que reciben el
// estado de la partida y lo modifican. systems/blackjackCobros cobra y paga, y juegos/casino/blackjack lleva la
// partida y pinta los mensajes; los tests usan una baraja preparada y un `rng` fijo para saber qué carta sale.

// --- Baraja real ---
function crearBaraja(numBarajas = 4) {
    const valores = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11]; // 10=J,Q,K, 11=As
    const palos = ["♠️", "♥️", "♦️", "♣️"];
    const baraja = [];
    for (let n = 0; n < numBarajas; n++) {
        for (const palo of palos) {
            for (let i = 0; i < valores.length; i++) {
                let display = valores[i];
                if (valores[i] === 11) display = "A";
                else if (valores[i] === 10 && i >= 8) display = ["J", "Q", "K"][i - 8];
                baraja.push({ value: valores[i], suit: palo, display: `${display}${palo}` });
            }
        }
    }
    return baraja;
}

function sacarCarta(baraja, rng = Math.random) {
    const idx = Math.floor(rng() * baraja.length);
    return baraja.splice(idx, 1)[0];
}

function handValue(hand) {
    let total = hand.reduce((sum, c) => sum + c.value, 0);
    let aces = hand.filter((c) => c.value === 11).length;
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function esBlackjack(hand) {
    return hand.length === 2 && handValue(hand) === 21;
}

// --- Partida ---
function robar(state) {
    return sacarCarta(state.baraja, state.rng);
}

/**
 * Reparte dos cartas a cada uno. La apuesta ya está cobrada; `saldoRestante` decide si se puede
 * doblar o separar (hace falta otra apuesta igual).
 */
function nuevaPartida({ apuesta, guildId, saldoRestante, baraja = crearBaraja(4), rng = Math.random }) {
    const state = { apuesta, guildId, baraja, rng, finished: false, ultimaAccion: Date.now() };
    state.userHand = [robar(state), robar(state)];
    state.botHand = [robar(state), robar(state)];
    state.puedeDoblar = saldoRestante >= apuesta;
    state.puedeSplit = state.userHand[0].value === state.userHand[1].value && saldoRestante >= apuesta;
    return state;
}

/** Blackjack natural al repartir: "empate_blackjack", "blackjack" (gana el jugador), "derrota_blackjack" o null. */
function naturales(state) {
    const jugador = esBlackjack(state.userHand);
    const crupier = esBlackjack(state.botHand);
    if (jugador && crupier) return "empate_blackjack";
    if (jugador) return "blackjack";
    if (crupier) return "derrota_blackjack";
    return null;
}

/** El crupier pide hasta llegar a 17 o más. Devuelve su valor final. */
function jugarCrupier(state) {
    let botVal = handValue(state.botHand);
    while (botVal < 17) {
        state.botHand.push(robar(state));
        botVal = handValue(state.botHand);
    }
    return botVal;
}

/** "gana", "empate" o "pierde". Pasarse pierde siempre, aunque el crupier también se pase. */
function resolver(userVal, botVal) {
    if (userVal > 21) return "pierde";
    if (botVal > 21 || userVal > botVal) return "gana";
    if (userVal === botVal) return "empate";
    return "pierde";
}

/** Lo que se cobra al ganar una mano (antes del RTP): el doble, o 2,5× con blackjack. */
function cobroGanador(apuesta, blackjack = false) {
    return blackjack ? Math.floor(apuesta * 2.5) : apuesta * 2;
}

/** Pedir carta. Si se pasa, la partida termina (perdida). */
function pedir(state) {
    state.userHand.push(robar(state));
    const valor = handValue(state.userHand);
    const pasado = valor > 21;
    if (pasado) state.finished = true;
    return { valor, pasado };
}

function plantarse(state) {
    const botVal = jugarCrupier(state);
    const userVal = handValue(state.userHand);
    state.finished = true;
    return { userVal, botVal, resultado: resolver(userVal, botVal) };
}

/** Doblar (la segunda apuesta ya está cobrada): una carta más y se planta. */
function doblar(state) {
    state.apuesta *= 2;
    state.userHand.push(robar(state));
    return plantarse(state);
}

/**
 * Separar (la segunda apuesta ya está cobrada): dos manos con una carta nueva cada una. Con dos
 * ases solo se reparte esa carta y ambas manos quedan plantadas (`sonAses`: ya se puede resolver).
 */
function separar(state) {
    const sonAses = state.userHand[0].value === 11 && state.userHand[1].value === 11;
    state.split = true;
    state.hands = [
        [state.userHand[0], robar(state)],
        [state.userHand[1], robar(state)],
    ];
    state.currentHand = 0;
    state.splitApuesta = state.apuesta;
    state.splitAses = sonAses;
    state.handResults = sonAses ? state.hands.map((h) => ({ result: "stand", value: handValue(h) })) : [];
    return { sonAses };
}

// Tras cerrar la mano actual: pasa a la siguiente o indica que ya no quedan.
function siguienteMano(state) {
    if (state.currentHand < state.hands.length - 1) {
        state.currentHand++;
        return false;
    }
    return true;
}

/** Pedir carta en la mano separada activa. `terminado`: no quedan manos por jugar. */
function pedirSplit(state) {
    const mano = state.hands[state.currentHand];
    mano.push(robar(state));
    const valor = handValue(mano);
    if (valor <= 21) return { valor, pasada: false, terminado: false };
    state.handResults.push({ result: "bust", value: valor });
    return { valor, pasada: true, terminado: siguienteMano(state) };
}

/** Plantarse en la mano separada activa. `terminado`: no quedan manos por jugar. */
function plantarseSplit(state) {
    state.handResults.push({ result: "stand", value: handValue(state.hands[state.currentHand]) });
    return { terminado: siguienteMano(state) };
}

/**
 * Juega el crupier y resuelve cada mano separada: "pasada" (se pasó el jugador), "gana", "empate"
 * o "pierde". Una mano de dos cartas que suma 21 cuenta como blackjack (cobra 2,5×).
 */
function resolverSplit(state) {
    const botVal = jugarCrupier(state);
    state.finished = true;
    const manos = state.hands.map((cartas, i) => {
        const { result, value } = state.handResults[i];
        return {
            cartas,
            valor: value,
            blackjack: cartas.length === 2 && value === 21,
            resultado: result === "bust" ? "pasada" : resolver(value, botVal),
        };
    });
    return { botVal, manos };
}

/** Lo que hay en juego (para liquidar una partida abandonada). */
function totalApostado(state) {
    return state.split ? state.splitApuesta * 2 : state.apuesta;
}

module.exports = {
    crearBaraja,
    sacarCarta,
    handValue,
    esBlackjack,
    nuevaPartida,
    naturales,

    resolver,
    cobroGanador,
    pedir,
    plantarse,
    doblar,
    separar,
    pedirSplit,
    plantarseSplit,
    resolverSplit,
    totalApostado,
};
