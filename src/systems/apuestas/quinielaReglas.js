// Reglas de apostar una quiniela, sin Discord ni formularios (#474): si los pronósticos y la cantidad valen, si hay efectivo, si ya
// se apostó, el tope diario del servidor y si la jornada ya está cerrada por tiempo. El formulario de juegos/apuestas/quiniela
// llama a esto y solo traduce el resultado a un mensaje.
const dinero = require("../dinero");
const limites = require("./limites");
const { estaBloqueadoPorTiempo, yaApostoQuiniela } = require("./quinielas");
const { logInfo } = require("../../core/logger");

/** Lo que consultan las reglas al cobrar (#474): en los tests se pasan dobles y no hace falta la base de datos. */
const REALES_APUESTA = {
    saldoGastable: (userId) => dinero.saldoGastable(userId),
    yaAposto: yaApostoQuiniela,
    comprobarLimite: limites.comprobar,
};

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
 * `d`: las dependencias con las que se consulta el efectivo, la apuesta repetida y el tope diario (dobles en los tests).
 */
function avisoDeApuesta({ userId, guildId, quinielaId, partidos, pronosticos, pronosticosCompletos = true, cantidad }, d = REALES_APUESTA) {
    if (!pronosticosValidos(pronosticos, partidos) || !pronosticosCompletos) {
        return "❌ Pronósticos incompletos o inválidos. Completa todos los partidos antes de confirmar.";
    }
    if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
        return `❌ Cantidad inválida. Debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT}.`;
    }
    // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino). Se apuesta con el 💵 efectivo + 🥷 dinero negro
    // (systems/dinero, F-EC-06b: se gasta igual).
    if (d.saldoGastable(userId) < cantidad) return SIN_EFECTIVO;
    if (d.yaAposto(quinielaId, userId)) return "⚠️ Ya has apostado esta quiniela.";
    // 🚦 Tope diario del servidor (F-AP-09), que suma partidos y quiniela.
    const limite = d.comprobarLimite(guildId, userId, cantidad);
    if (limite) {
        logInfo(`[Quiniela] Apuesta de ${userId} (${cantidad}) rechazada por los límites: ${limite}`);
        return `🚦 ${limite}`;
    }
    return null;
}

/**
 * El favorito de un partido según las cuotas (#366): «1», «X» o «2» con la cuota más baja. El empate solo cuando su cuota es la
 * menor sin empatar con otra; en un empate de cuotas entre local y visitante, gana el local. null si el partido no tiene ninguna cuota.
 */
function favorito({ cuota_home: local, cuota_draw: empate, cuota_away: visitante }) {
    const validas = [
        ["1", Number(local)],
        ["2", Number(visitante)],
        ["X", Number(empate)],
    ].filter(([, c]) => Number.isFinite(c) && c > 0);
    if (!validas.length) return null;
    return validas.reduce((mejor, actual) => (actual[1] < mejor[1] ? actual : mejor))[0];
}

/**
 * Rellena con el favorito los partidos sin pronóstico (#366). No toca los que ya tienen pronóstico ni los que ya están bloqueados
 * por tiempo. `partidos`: los de la quiniela con sus cuotas (cuota_home, cuota_draw, cuota_away) y su hora de inicio.
 * @returns {{ pronosticos: (string|null)[], rellenados: number }}
 */
function sugerirPronosticos(partidos, pronosticos) {
    let rellenados = 0;
    const nuevos = pronosticos.map((pronostico, i) => {
        const partido = partidos[i];
        if (pronostico || !partido || estaBloqueadoPorTiempo(partido.start_time)) return pronostico;
        const sugerido = favorito(partido);
        if (sugerido) rellenados++;
        return sugerido ?? pronostico;
    });
    return { pronosticos: nuevos, rellenados };
}

module.exports = {
    MAX_BET_AMOUNT,
    MIN_BET_AMOUNT,
    SIN_EFECTIVO,
    pronosticosValidos,
    cierreDeLaJornada,
    avisoDeApuesta,
    favorito,
    sugerirPronosticos,
};
