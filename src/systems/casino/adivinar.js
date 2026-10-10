// Reglas de adivinar la carta: la baraja, qué cuenta como acierto en cada ronda, cómo crece el acumulado y el
// cobro de cada final (perder, acertar el palo, retirarse o abandonar). juegos/casino/adivinar lleva las rondas,
// los botones y los mensajes.
const { procesarGanancia, procesarPerdida, applyRtp } = require("../casinoTransactions");

// Baraja de 52 cartas mezclada (Fisher-Yates con Math.random)
function crearBaraja() {
    const palos = ["♠", "♣", "♥", "♦"];
    const valores = [2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K", "A"];
    const baraja = [];
    for (const palo of palos) {
        for (const valor of valores) {
            baraja.push({ palo, valor });
        }
    }
    // Mezclar baraja
    for (let i = baraja.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [baraja[i], baraja[j]] = [baraja[j], baraja[i]];
    }
    return baraja;
}

// Utilidad para comparar valores de cartas
function getValorNumerico(valor) {
    if (typeof valor === "number") return valor;
    if (valor === "A") return 14;
    if (valor === "K") return 13;
    if (valor === "Q") return 12;
    if (valor === "J") return 11;
    return parseInt(valor);
}

// Ronda 1: el color (rojo son corazones y diamantes).
function aciertaColor(eleccion, carta) {
    const esRojo = carta.palo === "♥" || carta.palo === "♦";
    return (eleccion === "rojo" && esRojo) || (eleccion === "negro" && !esRojo);
}

// Ronda 2: si la siguiente carta es mayor o menor que la primera (`eleccion`: "mayor" o "menor").
function aciertaMayorMenor(eleccion, valorAnterior, valorNuevo) {
    return (eleccion === "mayor" && valorNuevo > valorAnterior) || (eleccion === "menor" && valorNuevo < valorAnterior);
}

// Ronda 3: si la carta cae entre las dos anteriores, ambas incluidas (`eleccion`: "dentro" o "fuera").
function aciertaDentroFuera(eleccion, v1, v2, v3) {
    const min = Math.min(v1, v2);
    const max = Math.max(v1, v2);
    const esDentro = v3 >= min && v3 <= max;
    return (eleccion === "dentro" && esDentro) || (eleccion === "fuera" && !esDentro);
}

// Acumulado al entrar en una ronda tras acertar: ×2 en la 2, ×3 en total en la 3 y ×4 en total en la 4.
function acumuladoAlEntrarRonda(ronda, apuesta, acumulado) {
    if (ronda === 2) return apuesta * 2;
    if (ronda === 3) return Math.floor(acumulado * 1.5);
    return Math.floor(acumulado * 1.33);
}

// Partida perdida en una ronda (la apuesta ya se descontó al empezar).
function registrarPerdida(userId, partida, ronda) {
    return procesarPerdida(userId, "adivinar", partida.apuesta, `Adivinar: perdió en la ronda ${ronda}`, {
        guildId: partida.guildId,
        cartas: partida.cartas,
        ronda,
        fallo: true,
    });
}

// Partida sin tocar más de 15 min: se liquida como perdida.
function registrarAbandono(userId, partida) {
    return procesarPerdida(userId, "adivinar", partida.apuesta, "Adivinar: partida abandonada", {
        guildId: partida.guildId,
        cartas: partida.cartas,
        ronda: partida.ronda,
        abandono: true,
    });
}

// Ronda 4: acertar el palo paga ×20 con el RTP del servidor (el premio sustituye al acumulado, o
// procesarGanancia pagaría solo ×4); fallar pierde la apuesta. Devuelve si la transacción salió bien.
function cobrarPalo(userId, guildId, partida, paloElegido, acierta) {
    let ganancia = 0; // Ya se descontó la apuesta al entrar
    if (acierta) {
        partida.acumulado = applyRtp(guildId, "adivinar", partida.apuesta, partida.acumulado * 5); // x20 en total
        ganancia = partida.acumulado - partida.apuesta; // Solo la ganancia neta
    }
    const detalle = { cartas: partida.cartas, paloElegido, exito: acierta };
    if (acierta && ganancia > 0) {
        return procesarGanancia(
            userId,
            "adivinar",
            partida.apuesta,
            partida.acumulado,
            `Adivinar: completó todas las rondas y ganó ${ganancia} monedas`,
            detalle,
        );
    }
    return procesarPerdida(userId, "adivinar", partida.apuesta, `Adivinar: perdió en la ronda final`, detalle);
}

// Retirarse (a partir de la ronda 3): cobra lo acumulado con el RTP. Devuelve si salió bien y la ganancia neta.
function cobrarRetiro(userId, guildId, partida, ronda) {
    let ganancia = partida.acumulado - partida.apuesta; // Solo la ganancia neta
    let exito;
    if (ganancia > 0) {
        partida.acumulado = applyRtp(guildId, "adivinar", partida.apuesta, partida.acumulado);
        ganancia = partida.acumulado - partida.apuesta;
        exito = procesarGanancia(
            userId,
            "adivinar",
            partida.apuesta,
            partida.acumulado,
            `Adivinar: se retiró en ronda ${ronda} y ganó ${ganancia} monedas`,
            {
                cartas: partida.cartas,
                retirado: true,
                ronda,
            },
        );
    } else {
        // En caso de empate exacto (muy raro)
        exito = procesarGanancia(
            userId,
            "adivinar",
            partida.apuesta,
            partida.apuesta,
            `Adivinar: se retiró en ronda ${ronda} sin ganancias`,
            {
                cartas: partida.cartas,
                retirado: true,
                ronda,
            },
        );
    }
    return { exito, ganancia };
}

module.exports = {
    crearBaraja,
    getValorNumerico,
    aciertaColor,
    aciertaMayorMenor,
    aciertaDentroFuera,
    acumuladoAlEntrarRonda,
    registrarPerdida,
    registrarAbandono,
    cobrarPalo,
    cobrarRetiro,
};
