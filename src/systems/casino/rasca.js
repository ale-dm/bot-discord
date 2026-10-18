// Reglas del rasca y gana: la tabla de premios (multiplicador y peso), el cartón de 3×3 y el cobro de la partida.
// juegos/casino/rasca pinta el cartón y el resultado en Discord.
const { descontarApuesta, procesarGanancia, procesarPerdida, applyRtp, obtenerSaldo } = require("../casinoTransactions");

// Premios por multiplicador de la apuesta. Los pesos suman 100000 y el RTP base es 90,5 %
// (Σ peso × multiplicador / 100000). El RTP del servidor (`casino.rtp_rasca`) escala el premio neto.
const PREMIOS = [
    { simbolo: "🍒", nombre: "Cereza", multiplicador: 2, peso: 16500 },
    { simbolo: "🍋", nombre: "Limón", multiplicador: 3, peso: 5000 },
    { simbolo: "🍊", nombre: "Naranja", multiplicador: 5, peso: 2000 },
    { simbolo: "🍇", nombre: "Uvas", multiplicador: 8, peso: 1000 },
    { simbolo: "🔔", nombre: "Campana", multiplicador: 15, peso: 500 },
    { simbolo: "💎", nombre: "Diamante", multiplicador: 30, peso: 400 },
    { simbolo: "⭐", nombre: "Estrella", multiplicador: 50, peso: 100 },
];
const PESO_PERDER = 74500;
const PESO_TOTAL = PESO_PERDER + PREMIOS.reduce((suma, premio) => suma + premio.peso, 0);
const FILAS = 3;
const COLUMNAS = 3;
const CELDAS = FILAS * COLUMNAS;

// Los símbolos que pueden rellenar el cartón son los de los premios, para que el dibujo sea coherente.
const SIMBOLOS = PREMIOS.map((premio) => premio.simbolo);

// Fisher-Yates con el `rng` inyectable (en los tests se fija).
function barajar(lista, rng) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(rng() * (i + 1)));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

/** Elige el premio del cartón (null si no toca nada). */
function elegirResultado(rng = Math.random) {
    let r = rng() * PESO_TOTAL;
    if (r < PESO_PERDER) return null;
    r -= PESO_PERDER;
    for (const premio of PREMIOS) {
        if (r < premio.peso) return premio;
        r -= premio.peso;
    }
    return PREMIOS[PREMIOS.length - 1];
}

/**
 * Rellena un cartón de 9 símbolos coherente con el resultado:
 * - con premio: el símbolo ganador sale 3 veces y ningún otro llega a 3;
 * - sin premio: ningún símbolo sale 3 veces (cuatro parejas y un suelto).
 */
function generarCarton(resultado, rng = Math.random) {
    const celdas = new Array(CELDAS).fill(null);
    const posiciones = barajar([...Array(CELDAS).keys()], rng);

    if (resultado) {
        for (let i = 0; i < 3; i++) celdas[posiciones[i]] = resultado.simbolo;
        // El resto, con tres símbolos distintos repetidos dos veces: así ninguno llega a tres.
        const otros = barajar(
            SIMBOLOS.filter((simbolo) => simbolo !== resultado.simbolo),
            rng,
        );
        const relleno = [...otros.slice(0, 3), ...otros.slice(0, 3)];
        const huecos = barajar(posiciones.slice(3), rng);
        relleno.forEach((simbolo, i) => {
            celdas[huecos[i]] = simbolo;
        });
        return celdas;
    }

    // Sin premio: cuatro símbolos repetidos dos veces y uno suelto (máximo dos de cada).
    const elegidos = barajar(SIMBOLOS, rng).slice(0, 5);
    const relleno = [...elegidos.slice(0, 4), ...elegidos.slice(0, 4), elegidos[4]];
    const huecos = barajar(posiciones, rng);
    relleno.forEach((simbolo, i) => {
        celdas[huecos[i]] = simbolo;
    });
    return celdas;
}

/** Cuántas veces sale cada símbolo en el cartón. */
function contarSimbolos(carton) {
    return carton.reduce((cuenta, simbolo) => {
        cuenta[simbolo] = (cuenta[simbolo] || 0) + 1;
        return cuenta;
    }, {});
}

/**
 * Juega una partida: cobra la apuesta, elige el premio, dibuja el cartón y lo liquida.
 * @returns {{exito: boolean, mensaje?: string, resultado?: object|null, carton?: string[], apuesta?: number,
 *   gananciaTotal?: number, neto?: number, saldo?: number}}
 */
function jugar(userId, guildId, apuesta, { rng = Math.random } = {}) {
    const cobro = descontarApuesta(userId, apuesta, guildId, "rasca");
    if (!cobro.exito) return { exito: false, mensaje: cobro.mensaje };

    const resultado = elegirResultado(rng);
    const carton = generarCarton(resultado, rng);
    const gananciaTotal = resultado ? applyRtp(guildId, "rasca", apuesta, apuesta * resultado.multiplicador) : 0;
    const detalle = {
        guildId,
        carton,
        multiplicador: resultado?.multiplicador || 0,
        simbolo: resultado?.simbolo || null,
        premio: gananciaTotal,
    };

    if (resultado) {
        procesarGanancia(
            userId,
            "rasca",
            apuesta,
            gananciaTotal,
            `🎟️ Rasca y gana: ${resultado.nombre} ×${resultado.multiplicador}`,
            detalle,
        );
    } else {
        procesarPerdida(userId, "rasca", apuesta, "🎟️ Rasca y gana: sin premio", detalle);
    }

    return {
        exito: true,
        resultado,
        carton,
        apuesta,
        gananciaTotal,
        neto: gananciaTotal - apuesta,
        saldo: obtenerSaldo(userId),
    };
}

module.exports = {
    PREMIOS,
    PESO_PERDER,
    PESO_TOTAL,
    FILAS,
    COLUMNAS,
    CELDAS,
    elegirResultado,
    generarCarton,
    contarSimbolos,
    jugar,
};
