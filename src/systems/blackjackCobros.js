// Cobros de blackjack (DT-16): pagar una mano según cómo acabó, y cobrar lo que cuesta doblar o separar.
// Las reglas de cada jugada están en ./blackjack; aquí solo el dinero.
const bj = require("./blackjack");
const activeGames = require("./activeGames");
const { descontarExtra, procesarGanancia, procesarPerdida, applyRtp } = require("./casinoTransactions");

function liquidarMano(userId, guildId, apuesta, resultado, { blackjack = false, descripcion, detalle }) {
    if (resultado === "gana") {
        const cobro = applyRtp(guildId, "blackjack", apuesta, bj.cobroGanador(apuesta, blackjack));
        return { exito: procesarGanancia(userId, "blackjack", apuesta, cobro, descripcion(cobro), detalle), cobro };
    }
    if (resultado === "empate") {
        return { exito: procesarGanancia(userId, "blackjack", apuesta, apuesta, descripcion(apuesta), detalle), cobro: apuesta };
    }
    return { exito: procesarPerdida(userId, "blackjack", apuesta, descripcion(0), detalle), cobro: 0 };
}

/** Blackjack natural al repartir: el natural paga, empatan dos naturales, o el crupier con natural gana. Devuelve { exito, cobro }. */
function cobrarNatural(userId, guildId, state, tipo) {
    const { apuesta, userHand, botHand } = state;
    const detalle = { tipo, userHand, botHand };
    if (tipo === "empate_blackjack") {
        return {
            exito: procesarGanancia(userId, "blackjack", apuesta, apuesta, "Blackjack: empate de blackjacks naturales", detalle),
            cobro: apuesta,
        };
    }
    if (tipo === "blackjack") {
        return liquidarMano(userId, guildId, apuesta, "gana", {
            blackjack: true,
            descripcion: (cobro) => `Blackjack: blackjack natural (+${cobro - apuesta})`,
            detalle,
        });
    }
    return { exito: procesarPerdida(userId, "blackjack", apuesta, "Blackjack: crupier tiene blackjack natural", detalle), cobro: 0 };
}

/** Pasarse pidiendo carta: se pierde la apuesta en el acto. */
function cobrarPasada(userId, state) {
    return procesarPerdida(userId, "blackjack", state.apuesta, "Blackjack: se pasó pidiendo carta", {
        tipo: "derrota_bust",
        userHand: state.userHand,
        botHand: state.botHand,
    });
}

/** Partida abandonada (más de 15 min sin tocar): lo que hay en juego se pierde. */
function cobrarAbandono(userId, state) {
    return procesarPerdida(userId, "blackjack", bj.totalApostado(state), "Blackjack: partida abandonada", {
        tipo: "abandono",
        guildId: state.guildId,
        userHand: state.split ? state.hands : state.userHand,
        botHand: state.botHand,
    });
}

/** Liquida una mano de un split (la número `n`) según cómo ha acabado. Devuelve { exito, cobro }. */
function liquidarManoSplit(userId, guildId, state, mano, n, botVal) {
    const { apuesta } = state;
    const detalle = { mano: n, userHand: mano.cartas, botHand: state.botHand };
    if (mano.resultado === "pasada") {
        return liquidarMano(userId, guildId, apuesta, "pierde", {
            descripcion: () => `Blackjack split: mano ${n} se pasó`,
            detalle: { tipo: "derrota_bust_split", ...detalle },
        });
    }
    if (mano.resultado === "gana") {
        const crupierPasado = botVal > 21;
        return liquidarMano(userId, guildId, apuesta, "gana", {
            blackjack: mano.blackjack,
            descripcion: () => `Blackjack split: mano ${n} ganó${crupierPasado ? " (crupier se pasó)" : ""}`,
            detalle: { tipo: mano.blackjack ? "blackjack_split" : "victoria_split", ...detalle },
        });
    }
    if (mano.resultado === "empate") {
        return liquidarMano(userId, guildId, apuesta, "empate", {
            descripcion: () => `Blackjack split: mano ${n} empató`,
            detalle: { tipo: "empate_split", ...detalle },
        });
    }
    return liquidarMano(userId, guildId, apuesta, "pierde", {
        descripcion: () => `Blackjack split: mano ${n} perdió`,
        detalle: { tipo: "derrota_split", ...detalle },
    });
}

/** Descuenta lo que cuesta doblar o separar. Devuelve { exito, mensaje } (el mensaje, si no hay saldo). */
function cobrarExtraBJ(userId, guildId, apuesta) {
    const resultado = descontarExtra(userId, apuesta, guildId);
    if (!resultado.exito) return resultado;
    activeGames.sumarApuesta(userId, "blackjack", apuesta);
    return { exito: true };
}

module.exports = { liquidarMano, cobrarNatural, cobrarPasada, cobrarAbandono, liquidarManoSplit, cobrarExtraBJ };
