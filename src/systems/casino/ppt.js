// Reglas de piedra, papel o tijera: qué vence a qué, la jugada del duende y el cobro de una partida.
// juegos/casino/ppt pide la jugada, pinta el resultado y las frases.
const { procesarGanancia, procesarPerdida } = require("../casinoTransactions");

// Cada jugada y la que vence
const OPCIONES = {
    piedra: { gana_a: "tijera" },
    papel: { gana_a: "piedra" },
    tijera: { gana_a: "papel" },
};

// La jugada del duende: una al azar entre las tres.
function jugadaDuende() {
    const claves = Object.keys(OPCIONES);
    return claves[Math.floor(Math.random() * claves.length)];
}

// "victoria", "derrota" o "empate" según la jugada del jugador y la del duende.
function resolverJugada(jugadaUsuario, jugadaDelDuende) {
    if (jugadaUsuario === jugadaDelDuende) return "empate";
    if (OPCIONES[jugadaUsuario].gana_a === jugadaDelDuende) return "victoria";
    return "derrota";
}

// Cobra la partida: la victoria paga el doble de la apuesta, el empate la devuelve y la derrota la pierde (la
// apuesta ya se descontó). Devuelve si la transacción salió bien y la ganancia acreditada (0 si se pierde).
function liquidarJugada(userId, guildId, cantidad, tipo, jugadaUsuario, jugadaDelDuende) {
    const descripcion = `PPT: ${jugadaUsuario} vs ${jugadaDelDuende} (${tipo}), apuesta ${cantidad}`;
    const detalle = { jugadaUsuario, jugadaDuende: jugadaDelDuende, guildId };
    if (tipo === "derrota") {
        return { exito: procesarPerdida(userId, "ppt", cantidad, descripcion, detalle), ganancia: 0 };
    }
    const ganancia = tipo === "victoria" ? cantidad * 2 : cantidad;
    return { exito: procesarGanancia(userId, "ppt", cantidad, ganancia, descripcion, detalle), ganancia };
}

module.exports = { OPCIONES, jugadaDuende, resolverJugada, liquidarJugada };
