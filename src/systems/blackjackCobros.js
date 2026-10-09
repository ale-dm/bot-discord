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

/** Descuenta lo que cuesta doblar o separar. Devuelve { exito, mensaje } (el mensaje, si no hay saldo). */
function cobrarExtraBJ(userId, guildId, apuesta) {
    const resultado = descontarExtra(userId, apuesta, guildId);
    if (!resultado.exito) return resultado;
    activeGames.sumarApuesta(userId, "blackjack", apuesta);
    return { exito: true };
}

module.exports = { liquidarMano, cobrarExtraBJ };
