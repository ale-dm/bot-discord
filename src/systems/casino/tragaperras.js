// Reglas de la tragaperras: símbolos y pesos, los carretes, cuánto paga cada combinación, el jackpot progresivo
// y el cobro de un giro. juegos/casino/tragaperras anima los carretes y pinta los mensajes.
const db = require("../../core/db");
const { procesarGanancia, procesarPerdida, applyRtp } = require("../casinoTransactions");
const { logInfo } = require("../../core/logger");

// Símbolos y sus valores
const SIMBOLOS = {
    "🍒": { valor: 2, peso: 30, nombre: "Cereza" }, // Común
    "🍋": { valor: 3, peso: 25, nombre: "Limón" }, // Común
    "🍊": { valor: 4, peso: 20, nombre: "Naranja" }, // Común
    "🍇": { valor: 5, peso: 15, nombre: "Uvas" }, // Poco común
    "🔔": { valor: 8, peso: 10, nombre: "Campana" }, // Raro
    "💎": { valor: 15, peso: 5, nombre: "Diamante" }, // Muy raro
    "⭐": { valor: 25, peso: 3, nombre: "Estrella" }, // Épico
    "7️⃣": { valor: 50, peso: 2, nombre: "Siete" }, // Legendario (JACKPOT!)
};

/**
 * Obtener símbolo aleatorio basado en pesos
 */
function obtenerSimboloAleatorio() {
    const simbolos = Object.keys(SIMBOLOS);
    const pesoTotal = Object.values(SIMBOLOS).reduce((sum, s) => sum + s.peso, 0);
    let random = Math.random() * pesoTotal;

    for (const simbolo of simbolos) {
        random -= SIMBOLOS[simbolo].peso;
        if (random <= 0) return simbolo;
    }

    return simbolos[0]; // Fallback
}

/**
 * Girar los carretes
 */
function girarCarretes() {
    return [obtenerSimboloAleatorio(), obtenerSimboloAleatorio(), obtenerSimboloAleatorio()];
}

/**
 * Calcular ganancia basada en los resultados
 */
function calcularGanancia(carretes, apuesta, jackpotOverride = null) {
    const [s1, s2, s3] = carretes;

    // JACKPOT: 3 sietes
    if (s1 === "7️⃣" && s2 === "7️⃣" && s3 === "7️⃣") {
        const jackpot = jackpotOverride ?? obtenerJackpot();
        return {
            multiplicador: "JACKPOT",
            ganancia: jackpot,
            tipo: "jackpot",
            mensaje: `🎰💰 ¡¡¡JACKPOT!!! 💰🎰`,
        };
    }

    // Tres iguales
    if (s1 === s2 && s2 === s3) {
        const multi = SIMBOLOS[s1].valor;
        return {
            multiplicador: `x${multi}`,
            ganancia: apuesta * multi,
            tipo: "triple",
            mensaje: `🎊 ¡TRIPLE ${SIMBOLOS[s1].nombre.toUpperCase()}! 🎊`,
        };
    }

    // Dos iguales
    if (s1 === s2 || s2 === s3 || s1 === s3) {
        const simboloRepetido = s1 === s2 ? s1 : s2 === s3 ? s2 : s1;
        const multi = Math.max(1, Math.ceil(SIMBOLOS[simboloRepetido].valor / 3));
        return {
            multiplicador: `x${multi}`,
            ganancia: apuesta * multi,
            tipo: "doble",
            mensaje: `🎉 ¡Doble ${SIMBOLOS[simboloRepetido].nombre}! 🎉`,
        };
    }

    // Sin premio
    return {
        multiplicador: "x0",
        ganancia: 0,
        tipo: "perdida",
        mensaje: "😢 Sin premio esta vez...",
    };
}

/**
 * Obtener jackpot actual
 */
function obtenerJackpot() {
    const result = db.prepare("SELECT cantidad FROM slots_jackpot WHERE id = 1").get();
    return result ? result.cantidad : 10000;
}

/**
 * Incrementar jackpot
 */
function incrementarJackpot(cantidad) {
    db.prepare("UPDATE slots_jackpot SET cantidad = cantidad + ? WHERE id = 1").run(cantidad);
}

/**
 * Resetear jackpot después de ganarlo
 */
function resetearJackpot() {
    db.prepare("UPDATE slots_jackpot SET cantidad = 10000 WHERE id = 1").run();
}

// Gira los carretes, suma al jackpot y paga (o registra la pérdida). Devuelve el giro y el jackpot ya actualizado.
function liquidarGiro(userId, guildId, username, apuesta) {
    // Girar carretes y calcular resultado
    const carretes = girarCarretes();
    const resultado = calcularGanancia(carretes, apuesta);

    // Incrementar jackpot con el 10% de la apuesta
    const contribucionJackpot = Math.floor(apuesta * 0.1);
    incrementarJackpot(contribucionJackpot);

    let nuevoJackpot = obtenerJackpot();

    // Procesar resultado
    if (resultado.tipo === "jackpot") {
        const gananciaReal = applyRtp(guildId, "tragaperras", apuesta, resultado.ganancia);
        resultado.ganancia = gananciaReal; // mantener el embed de resultado en sync con lo realmente acreditado
        const exito = procesarGanancia(userId, "tragaperras", apuesta, gananciaReal, `🎰 JACKPOT en Tragaperras (+${gananciaReal})`, {
            carretes,
            tipo: "JACKPOT",
            multiplicador: "JACKPOT",
            jackpot: resultado.ganancia,
        });

        if (exito) {
            resetearJackpot();
            nuevoJackpot = obtenerJackpot();
            logInfo(`[TRAGAPERRAS] ¡¡¡JACKPOT!!! Usuario ${username} ganó ${gananciaReal} monedas`);
        }
    } else if (resultado.ganancia > 0) {
        const gananciaReal = applyRtp(guildId, "tragaperras", apuesta, resultado.ganancia);
        resultado.ganancia = gananciaReal; // mantener el embed de resultado en sync con lo realmente acreditado
        const exito = procesarGanancia(
            userId,
            "tragaperras",
            apuesta,
            gananciaReal,
            `🎰 Victoria en Tragaperras (+${gananciaReal - apuesta})`,
            {
                carretes,
                tipo: resultado.tipo,
                multiplicador: resultado.multiplicador,
            },
        );

        if (exito) {
            logInfo(`[TRAGAPERRAS] Usuario ${username} ganó ${gananciaReal} (${resultado.multiplicador})`);
        }
    } else {
        // Pérdida (ya se descontó la apuesta)
        procesarPerdida(userId, "tragaperras", apuesta, `🎰 Pérdida en Tragaperras (-${apuesta})`, {
            carretes,
            tipo: "perdida",
            multiplicador: "x0",
        });

        logInfo(`[TRAGAPERRAS] Usuario ${username} perdió ${apuesta}`);
    }

    return { carretes, resultado, nuevoJackpot };
}

module.exports = { SIMBOLOS, girarCarretes, calcularGanancia, obtenerJackpot, liquidarGiro };
