// Reglas de apostar una quiniela, sin Discord ni formularios (#474): si los pronósticos y la cantidad valen, si hay efectivo, si ya
// se apostó, el tope diario del servidor y si la jornada ya está cerrada por tiempo. El formulario de juegos/apuestas/quiniela
// llama a esto y solo traduce el resultado a un mensaje.
const dinero = require("../dinero");
const limites = require("./limites");
const { estaBloqueadoPorTiempo, yaApostoQuiniela } = require("./quinielas");
const { logInfo } = require("../../core/logger");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);
const SIN_EFECTIVO = "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar).";

/** ¿Los pronósticos («1X2…») valen para una quiniela de `partidos` partidos? */
const pronosticosValidos = (pronosticos, partidos) => pronosticos.length === partidos && !/[^12X]/.test(pronosticos);

/** El primer partido (ISO) de la jornada si ya está cerrada por tiempo para apostar, o null si se puede apostar. */
function cierreDeLaJornada(partidos) {
    const primerPartido = partidos.map((p) => p.start_time).sort()[0];
    return primerPartido && estaBloqueadoPorTiempo(primerPartido) ? primerPartido : null;
}

/**
 * El aviso de la primera comprobación que falle al apostar, o null si se puede cobrar. `pronosticosCompletos`: false si el
 * editor aún tiene algún partido sin rellenar. Síncrona a propósito: el tope diario va justo antes del cobro, sin await por medio.
 */
function avisoDeApuesta({ userId, guildId, quinielaId, partidos, pronosticos, pronosticosCompletos = true, cantidad }) {
    if (!pronosticosValidos(pronosticos, partidos) || !pronosticosCompletos) {
        return "❌ Pronósticos incompletos o inválidos. Completa todos los partidos antes de confirmar.";
    }
    if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
        return `❌ Cantidad inválida. Debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT}.`;
    }
    // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino). Se apuesta con el 💵 efectivo + 🥷 dinero negro
    // (systems/dinero, F-EC-06b: se gasta igual).
    if (dinero.saldoGastable(userId) < cantidad) return SIN_EFECTIVO;
    if (yaApostoQuiniela(quinielaId, userId)) return "⚠️ Ya has apostado esta quiniela.";
    // 🚦 Tope diario del servidor (F-AP-09), que suma partidos y quiniela.
    const limite = limites.comprobar(guildId, userId, cantidad);
    if (limite) {
        logInfo(`[Quiniela] Apuesta de ${userId} (${cantidad}) rechazada por los límites: ${limite}`);
        return `🚦 ${limite}`;
    }
    return null;
}

module.exports = { MAX_BET_AMOUNT, MIN_BET_AMOUNT, SIN_EFECTIVO, pronosticosValidos, cierreDeLaJornada, avisoDeApuesta };
