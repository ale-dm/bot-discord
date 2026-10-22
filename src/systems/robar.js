// /robar (F-EC-06b): cooldown GLOBAL por ladrón (no por servidor, a diferencia de /trabajar — el
// dinero ya es global, así que el cooldown también lo es: si no, se podría robar cada 2h por
// servidor en el que esté el bot). Lo robado se guarda como dinero negro (systems/dinero), aparte
// del efectivo normal.
//
// Objetos de protección (F-EC-06c): antes de cada intento se mira el inventario de la víctima. Son objetos normales de
// la tienda (se crean y editan en 🛒 Catálogo), con un efecto que funciona con solo tenerlos:
// - `antirrobo:N` (🔒 Candado): le quita N puntos a la probabilidad de éxito del ladrón. Se gasta con ese intento.
// - `trampa:N` (💣 Trampa): si el robo falla, la multa se multiplica por N. Se gasta solo cuando salta.
// Si tiene varios del mismo tipo, se usa el más fuerte (y se gasta solo ese).
const db = require("../core/db");
const dinero = require("./dinero");
const xpSystem = require("./xpSystem");
const seguroAntirrobo = require("./seguroAntirrobo");
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

/** Efectos de los objetos de protección: `antirrobo:N` (1-100 puntos) y `trampa:N` (multa ×2 a ×10). */
const EFECTO_PROTECCION = /^(antirrobo|trampa):(\d+)$/;
function efectoProteccion(efecto) {
    const m = EFECTO_PROTECCION.exec(String(efecto || ""));
    if (!m) return null;
    const valor = Number(m[2]);
    if (m[1] === "antirrobo" && valor >= 1 && valor <= 100) return { tipo: "antirrobo", valor };
    if (m[1] === "trampa" && valor >= 2 && valor <= 10) return { tipo: "trampa", valor };
    return null;
}

/** El mejor 🔒 antirrobo y la mejor 💣 trampa del inventario de alguien ({ inventarioId, nombre, valor } o null). */
function proteccionesDe(userId) {
    const filas = db
        .prepare(
            `SELECT inventario.id AS inventarioId, objeto.nombre, objeto.efecto FROM inventario JOIN objeto ON objeto.id = inventario.itemId
             WHERE inventario.userId = ? AND (objeto.efecto LIKE 'antirrobo:%' OR objeto.efecto LIKE 'trampa:%')
             ORDER BY inventario.id`,
        )
        .all(String(userId));
    const mejor = { antirrobo: null, trampa: null };
    for (const f of filas) {
        const e = efectoProteccion(f.efecto);
        if (e && (!mejor[e.tipo] || e.valor > mejor[e.tipo].valor))
            mejor[e.tipo] = { inventarioId: f.inventarioId, nombre: f.nombre, valor: e.valor };
    }
    return mejor;
}

const gastar = (proteccion) => db.prepare("DELETE FROM inventario WHERE id = ?").run(proteccion.inventarioId);

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
 * `candado` y `trampa`: el nombre del objeto de la víctima que se ha usado en este intento (si alguno).
 * `seguro`: "fallo" si el 🛡️ seguro antirrobo ha hecho fallar el golpe, "reducido" si se ha llevado la mitad, null si no hay.
 * @returns {
 *   { ok: false, reason: "cooldown", retrySeconds: number } |
 *   { ok: false, reason: "victima-pobre" } |
 *   { ok: true, exito: true, cantidad: number, candado: string|null, trampa: null, seguro: string|null } |
 *   { ok: true, exito: false, multa: number, candado: string|null, trampa: string|null, seguro: string|null }
 * }
 */
function robar(guildId, ladronId, victimaId) {
    const retrySeconds = cooldownRestante(ladronId);
    if (retrySeconds) return { ok: false, reason: "cooldown", retrySeconds };

    // El aviso a la víctima (DM) lo manda el comando (textoAvisoVictima); aquí solo se decide el robo.
    if (dinero.efectivo(victimaId) < MIN_VICTIMA) return { ok: false, reason: "victima-pobre" };

    marcarCooldown(ladronId);
    const { antirrobo, trampa } = proteccionesDe(victimaId);
    // 🔒 El candado se gasta con el intento, salga bien o mal.
    if (antirrobo) gastar(antirrobo);
    const probabilidad = Math.max(0, PROB_EXITO - (antirrobo ? antirrobo.valor / 100 : 0));
    let exito = Math.random() < probabilidad;
    const candado = antirrobo?.nombre || null;

    // 🛡️ Seguro antirrobo (#526): si el golpe iba a salir bien, puede hacerlo fallar o reducir el botín.
    // Se tira solo cuando el robo había salido bien, para no gastar azar en los que ya fallaban.
    const seguro = exito ? seguroAntirrobo.proteccion(victimaId) : null;
    let motivoSeguro = null;
    if (exito && seguro) {
        if (Math.random() < seguro.probFallo) {
            exito = false;
            motivoSeguro = "fallo";
        } else {
            motivoSeguro = "reducido";
        }
    }

    if (!exito) {
        // 💣 La trampa solo salta (y se gasta) si el robo falla.
        if (trampa) gastar(trampa);
        const multa = Math.min(entre(MULTA_MIN, MULTA_MAX) * (trampa ? trampa.valor : 1), dinero.efectivo(ladronId));
        if (multa > 0) {
            dinero.cobrar(ladronId, multa);
            dinero.apuntar(ladronId, "robo", trampa ? `Multa por un robo fallido (${trampa.nombre})` : "Multa por un robo fallido", -multa);
        }
        log.info(
            `${ladronId} falló robando a ${victimaId}${multa > 0 ? ` (multa ${multa})` : ""}` +
                `${candado ? ` · candado "${candado}"` : ""}${trampa ? ` · trampa "${trampa.nombre}"` : ""}` +
                `${motivoSeguro ? " · seguro" : ""}`,
        );
        return { ok: true, exito: false, multa, candado, trampa: trampa?.nombre || null, seguro: motivoSeguro };
    }

    const nivel = xpSystem.getProfile(guildId, ladronId).nivel || 0;
    let cantidad = Math.min(entre(BASE_MIN, BASE_MAX) + nivel * BONUS_POR_NIVEL, dinero.efectivo(victimaId));
    if (motivoSeguro === "reducido") cantidad = Math.max(1, Math.floor(cantidad * seguro.reduccion));
    dinero.cobrar(victimaId, cantidad);
    dinero.apuntar(victimaId, "robo", "Te han robado", -cantidad);
    dinero.pagarNegro(ladronId, cantidad);
    dinero.apuntar(ladronId, "robo", "Robo a alguien", cantidad);
    log.info(
        `${ladronId} robó ${cantidad} (dinero negro) a ${victimaId}${candado ? ` (a pesar del candado "${candado}")` : ""}` +
            `${motivoSeguro ? " · seguro" : ""}`,
    );
    return { ok: true, exito: true, cantidad, candado, trampa: null, seguro: motivoSeguro };
}

/**
 * El DM que recibe la víctima de un intento de robo (#432), o null si no hay nada que contarle (un robo fallido en el que
 * no saltó ningún objeto suyo). Dice lo que ha pasado y la cantidad, pero nunca quién ha sido el ladrón. Si el 🛡️ seguro
 * antirrobo (#526) ha entrado en juego, se lo cuenta solo a ella.
 */
function textoAvisoVictima(r) {
    if (!r?.ok) return null;
    const candado = r.candado ? ` Tu 🔒 **${r.candado}** se ha gastado en el intento.` : "";
    const seguro = r.seguro === "reducido" ? " Tu 🛡️ seguro antirrobo ha reducido el golpe a la mitad." : "";
    if (r.exito) return `🥷 Alguien te ha robado **${r.cantidad.toLocaleString("es")}** 🪙 en efectivo.${candado}${seguro}`;
    const frenado = r.seguro === "fallo" ? " Tu 🛡️ seguro antirrobo ha hecho que el golpe fallara." : "";
    if (!r.candado && !r.trampa && !frenado) return null;
    const trampa = r.trampa
        ? ` Tu 💣 **${r.trampa}** ha saltado${r.multa > 0 ? `: ha pagado una multa de **${r.multa.toLocaleString("es")}** 🪙` : ""}.`
        : "";
    return `🛡️ Alguien ha intentado robarte y le ha salido mal.${candado}${trampa}${frenado}`;
}

module.exports = { robar, textoAvisoVictima, efectoProteccion, proteccionesDe, COOLDOWN_SEC, MIN_VICTIMA, PROB_EXITO };
