// Reglas de entrada del casino: mínimo y máximo de apuesta (con el tope propio de cada juego, #460) y cooldown y cupo
// diario (con el cooldown propio de cada juego, #461). Las usa casinoTransactions.descontarApuesta, por donde pasa cada apuesta.
const guildSettings = require("./guildSettings");

const NOMBRE_JUEGO = {
    blackjack: "blackjack",
    tragaperras: "tragaperras",
    ruleta: "ruleta",
    ppt: "piedra, papel o tijera",
    adivinar: "adivinar la carta",
    rasca: "rasca y gana",
};

/** El tope de apuesta de un juego (#460): el suyo si lo tiene, y si no el general. */
function maxApuesta(cfg, juego, minBet) {
    const propio = juego ? Number(cfg[`max_bet_${juego}`] || 0) : 0;
    if (propio > 0) return { maxBet: Math.max(minBet, propio), propio: true };
    return { maxBet: Math.max(minBet, Number(cfg.max_bet || 100000)), propio: false };
}

/**
 * Validar apuesta antes de procesar
 * @param {number} cantidad - Cantidad a apostar
 * @param {number} saldoDisponible - Saldo disponible del usuario
 * @param {string|null} guildId
 * @param {string|null} juego - Juego del casino: si tiene su propio tope de apuesta, vale ese en vez del general
 * @returns {object} - {valida: boolean, mensaje: string}
 */
function validarApuesta(cantidad, saldoDisponible, guildId = null, juego = null) {
    const cfg = guildSettings.getSettings(guildId).casino;
    const minBet = Math.max(1, Number(cfg.min_bet || 10));
    const { maxBet, propio } = maxApuesta(cfg, juego, minBet);

    if (!cantidad || cantidad <= 0) {
        return { valida: false, mensaje: "❌ La cantidad debe ser mayor que cero." };
    }

    if (cantidad < minBet) {
        return { valida: false, mensaje: `❌ La apuesta mínima es de ${minBet.toLocaleString("es")} monedas.` };
    }

    if (cantidad > maxBet) {
        const donde = propio ? ` en ${NOMBRE_JUEGO[juego] || juego}` : "";
        return { valida: false, mensaje: `❌ La apuesta máxima${donde} es de ${maxBet.toLocaleString("es")} monedas.` };
    }

    if (cantidad > saldoDisponible) {
        return { valida: false, mensaje: "❌ No te llega el efectivo para esa apuesta. Saca dinero del banco (💵 Sacar)." };
    }

    return { valida: true, mensaje: "" };
}

/**
 * Cooldown y cupo diario de una jugada (#461). El cupo diario cuenta todos los juegos juntos (`casino_global`). El cooldown
 * es el global, salvo que el juego tenga el suyo: entonces se mide aparte (`casino_<juego>`) y jugar a otro juego no
 * espera por él (ni él por los demás).
 * @returns {{ ok: true } | { ok: false, mensaje: string }}
 */
function consumirLimites(userId, guildId, juego) {
    const cfg = guildSettings.getSettings(guildId).casino;
    const dailyLimit = Number(cfg.daily_limit || 0);
    const propio = juego ? Number(cfg[`cooldown_sec_${juego}`] || 0) : 0;
    const mensajeDe = (limit) =>
        limit.reason === "cooldown"
            ? `⏳ Espera ${limit.retrySeconds}s antes de volver a jugar${propio > 0 ? ` a ${NOMBRE_JUEGO[juego] || juego}` : ""}.`
            : "📛 Alcanzaste tu límite diario de jugadas en casino.";

    if (propio <= 0) {
        const limit = guildSettings.checkAndConsumeLimit(guildId, "casino_global", userId, {
            cooldownSec: Number(cfg.global_cooldown_sec || 0),
            dailyLimit,
        });
        return limit.ok ? { ok: true } : { ok: false, mensaje: mensajeDe(limit) };
    }

    // Con cooldown propio: primero se mira el cupo del día sin gastarlo, luego el cooldown del juego, y solo entonces se cuenta.
    const cupo = guildSettings.checkAndConsumeLimit(guildId, "casino_global", userId, { dailyLimit, consume: false });
    if (!cupo.ok) return { ok: false, mensaje: mensajeDe(cupo) };
    const espera = guildSettings.checkAndConsumeLimit(guildId, `casino_${juego}`, userId, { cooldownSec: propio });
    if (!espera.ok) return { ok: false, mensaje: mensajeDe(espera) };
    guildSettings.checkAndConsumeLimit(guildId, "casino_global", userId, { dailyLimit, marcarTiempo: false });
    return { ok: true };
}

module.exports = { NOMBRE_JUEGO, validarApuesta, consumirLimites };
