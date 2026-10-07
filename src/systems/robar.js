// /robar (F-EC-06b): cooldown GLOBAL por ladrón (no por servidor, a diferencia de /trabajar — el
// dinero ya es global, así que el cooldown también lo es: si no, se podría robar cada 2h por
// servidor en el que esté el bot). Lo robado se guarda como dinero negro (systems/dinero), aparte
// del efectivo normal.
const db = require("../core/db");
const dinero = require("./dinero");
const xpSystem = require("./xpSystem");
const { createLogger } = require("../core/logger");

const log = createLogger("Robar");

const COOLDOWN_SEC = Number(process.env.ROBAR_COOLDOWN_SEC || 2 * 60 * 60);
const MIN_VICTIMA = Number(process.env.ROBAR_MIN_VICTIMA || 150);
const PROB_EXITO = Number(process.env.ROBAR_PROB_EXITO || 0.65);
const BASE_MIN = Number(process.env.ROBAR_BASE_MIN || 50);
const BASE_MAX = Number(process.env.ROBAR_BASE_MAX || 150);
const BONUS_POR_NIVEL = Number(process.env.ROBAR_BONUS_NIVEL || 2);
const MULTA_MIN = Number(process.env.ROBAR_MULTA_MIN || 30);
const MULTA_MAX = Number(process.env.ROBAR_MULTA_MAX || 80);

/** Segundos que le quedan de cooldown a quien roba, o null si ya puede robar. */
function cooldownRestante(ladronId) {
    const row = db.prepare("SELECT lastTs FROM robos_cooldown WHERE userId = ?").get(String(ladronId));
    if (!row) return null;
    const diff = Date.now() - Number(row.lastTs || 0);
    if (diff >= COOLDOWN_SEC * 1000) return null;
    return Math.ceil((COOLDOWN_SEC * 1000 - diff) / 1000);
}

function marcarCooldown(ladronId) {
    db.prepare("INSERT INTO robos_cooldown (userId, lastTs) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET lastTs = excluded.lastTs").run(
        String(ladronId),
        Date.now(),
    );
}

function entre(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * @returns {
 *   { ok: false, reason: "cooldown", retrySeconds: number } |
 *   { ok: false, reason: "victima-pobre" } |
 *   { ok: true, exito: true, cantidad: number } |
 *   { ok: true, exito: false, multa: number }
 * }
 */
function robar(guildId, ladronId, victimaId) {
    const retrySeconds = cooldownRestante(ladronId);
    if (retrySeconds) return { ok: false, reason: "cooldown", retrySeconds };

    // Sin aviso a la víctima en el momento: solo se nota mirando su saldo o sus Movimientos.
    if (dinero.efectivo(victimaId) < MIN_VICTIMA) return { ok: false, reason: "victima-pobre" };

    marcarCooldown(ladronId);
    const exito = Math.random() < PROB_EXITO;

    if (!exito) {
        const multa = Math.min(entre(MULTA_MIN, MULTA_MAX), dinero.efectivo(ladronId));
        if (multa > 0) {
            dinero.cobrar(ladronId, multa);
            dinero.apuntar(ladronId, "robo", "Multa por un robo fallido", -multa);
        }
        log.info(`${ladronId} falló robando a ${victimaId}${multa > 0 ? ` (multa ${multa})` : ""}`);
        return { ok: true, exito: false, multa };
    }

    const nivel = xpSystem.getProfile(guildId, ladronId).nivel || 0;
    const cantidad = Math.min(entre(BASE_MIN, BASE_MAX) + nivel * BONUS_POR_NIVEL, dinero.efectivo(victimaId));
    dinero.cobrar(victimaId, cantidad);
    dinero.apuntar(victimaId, "robo", "Te han robado", -cantidad);
    dinero.pagarNegro(ladronId, cantidad);
    dinero.apuntar(ladronId, "robo", "Robo a alguien", cantidad);
    log.info(`${ladronId} robó ${cantidad} (dinero negro) a ${victimaId}`);
    return { ok: true, exito: true, cantidad };
}

module.exports = { robar, COOLDOWN_SEC, MIN_VICTIMA };
