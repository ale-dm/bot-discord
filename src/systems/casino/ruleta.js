// Reglas de la ruleta europea (0-36): colores, paridad, mitades y docenas, cuánto paga cada tipo de apuesta,
// la tirada y el cobro. juegos/casino/ruleta anima la rueda y pinta los mensajes; aquí no hay nada de Discord.
const { procesarGanancia, procesarPerdida, applyRtp } = require("../casinoTransactions");

const ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Orden real de la ruleta europea (sentido horario)
const WHEEL = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3,
    26,
];

function esRojo(n) {
    return ROJOS.has(n);
}

// Datos de un número. El 0 es verde: no tiene color rojo o negro, paridad, mitad ni docena.
function infoNum(n) {
    if (n === 0) return { colorNombre: "verde", par: false, mitad: null, docena: null };
    return {
        colorNombre: ROJOS.has(n) ? "rojo" : "negro",
        par: n % 2 === 0,
        mitad: n <= 18 ? "bajo" : "alto",
        docena: n <= 12 ? 1 : n <= 24 ? 2 : 3,
    };
}

// Retorna ganancia NETA (negativo = pierde apuesta)
function calcularPago(tipo, valor, n, apuesta) {
    const info = infoNum(n);
    let mult = -1;
    switch (tipo) {
        case "numero":
            mult = Number(valor) === n ? 35 : -1;
            break;
        case "color":
            mult = n !== 0 && valor === info.colorNombre ? 1 : -1;
            break;
        case "paridad":
            mult = n !== 0 && (valor === "par") === info.par ? 1 : -1;
            break;
        case "mitad":
            mult = n !== 0 && valor === info.mitad ? 1 : -1;
            break;
        case "docena":
            mult = n !== 0 && Number(valor) === info.docena ? 2 : -1;
            break;
    }
    return mult * apuesta;
}

// El número que sale: el único azar de la tirada.
function tirarNumero() {
    return Math.floor(Math.random() * 37);
}

// Cobra la tirada: paga la ganancia neta con el RTP del servidor, o registra la pérdida (la apuesta ya se
// descontó al empezar). Devuelve si la transacción salió bien y la ganancia neta (negativa si se pierde).
function liquidarTirada(userId, guildId, { apuesta, tipo, valor, numero }) {
    let gananciaNet = calcularPago(tipo, valor, numero, apuesta);
    let exito;
    if (gananciaNet > 0) {
        gananciaNet = applyRtp(guildId, "ruleta", apuesta, apuesta + gananciaNet) - apuesta;
        exito = procesarGanancia(userId, "ruleta", apuesta, apuesta + gananciaNet, `Ruleta: ganaste ${gananciaNet} (${tipo}:${valor})`, {
            n: numero,
            tipo,
            valor,
        });
    } else {
        exito = procesarPerdida(userId, "ruleta", apuesta, `Ruleta: perdiste ${apuesta} (${tipo}:${valor})`, {
            n: numero,
            tipo,
            valor,
        });
    }
    return { exito, gananciaNet };
}

module.exports = { WHEEL, esRojo, infoNum, calcularPago, tirarNumero, liquidarTirada };
