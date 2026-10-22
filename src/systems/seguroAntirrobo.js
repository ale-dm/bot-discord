// Seguro antirrobo (F-EC-19, #526): se paga una prima y, mientras está activo, los robos contra esa
// persona fallan el 60 % de las veces y, si no fallan, se llevan la mitad. No se acumula: renovar
// extiende desde el vencimiento, con un cooldown entre compras y un tope de días por delante.
// El seguro es global (como el dinero) y solo se configura por servidor (precio, duración, cooldown y tope).
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Seguro");
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
const DEFECTOS = { precio: 2000, horas: 24, cooldownHoras: 1, topeDias: 7 };
/** 60 % de que el golpe falle; si no falla, el botín se queda en la mitad. */
const PROB_FALLO = 0.6;
const REDUCCION = 0.5;

function entero(valor, defecto, min, max) {
    const n = Number(valor);
    return Number.isInteger(n) && n >= min && n <= max ? n : defecto;
}

/** Precio, duración, cooldown y tope del servidor, con los valores por defecto de la issue. */
function config(guildId) {
    const e = (guildId && guildSettings.getSettings(guildId).economia) || {};
    return {
        precio: entero(e.seguro_precio, DEFECTOS.precio, 1, 1_000_000),
        horas: entero(e.seguro_horas, DEFECTOS.horas, 1, 24 * 30),
        cooldownMs: entero(e.seguro_cooldown_h, DEFECTOS.cooldownHoras, 0, 24 * 30) * HORA_MS,
        topeMs: entero(e.seguro_tope_dias, DEFECTOS.topeDias, 1, 365) * DIA_MS,
    };
}

const fila = (userId) => db.prepare("SELECT inicio, vencimiento, comprado FROM seguros_antirrobo WHERE userId = ?").get(String(userId));

/** { activo, inicio, vencimiento, restanteMs }. Un seguro vencido ya no protege, aunque la fila siga ahí. */
function estado(userId, ahora = Date.now()) {
    const f = fila(userId);
    if (!f || Number(f.vencimiento) <= ahora) return { activo: false, inicio: 0, vencimiento: 0, restanteMs: 0 };
    return {
        activo: true,
        inicio: Number(f.inicio),
        vencimiento: Number(f.vencimiento),
        restanteMs: Number(f.vencimiento) - ahora,
    };
}

/**
 * Compra o renueva el seguro. Cobra del dinero gastable (negro primero, luego efectivo), como la tienda.
 * @returns {{ok:true, precio:number, vencimiento:number, extendido:boolean, cfg:object} |
 *   {ok:false, motivo:"cooldown", retrySeconds:number, cfg:object} |
 *   {ok:false, motivo:"tope", restanteMs:number, cfg:object} |
 *   {ok:false, motivo:"saldo", cfg:object}}
 */
function comprar(userId, guildId, ahora = Date.now()) {
    const cfg = config(guildId);
    const f = fila(userId);
    // Cooldown entre compras: ni renovar en bucle ni comprar dos veces seguidas.
    if (f && Number(f.comprado) && ahora - Number(f.comprado) < cfg.cooldownMs) {
        const retrySeconds = Math.ceil((cfg.cooldownMs - (ahora - Number(f.comprado))) / 1000);
        return { ok: false, motivo: "cooldown", retrySeconds, cfg };
    }
    const activo = estado(userId, ahora).activo;
    const inicio = activo ? Number(f.inicio) : ahora;
    // Con el seguro activo se extiende desde el vencimiento; si no, desde ahora.
    const desde = activo ? Number(f.vencimiento) : ahora;
    if (desde + cfg.horas * HORA_MS > ahora + cfg.topeMs) {
        return { ok: false, motivo: "tope", restanteMs: ahora + cfg.topeMs - desde, cfg };
    }
    if (dinero.saldoGastable(userId) < cfg.precio) return { ok: false, motivo: "saldo", cfg };

    const vencimiento = desde + cfg.horas * HORA_MS;
    const ok = db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, cfg.precio)) return false;
        dinero.apuntar(userId, "seguro", "Seguro antirrobo", -cfg.precio);
        db.prepare(
            `INSERT INTO seguros_antirrobo (userId, inicio, vencimiento, comprado) VALUES (?, ?, ?, ?)
             ON CONFLICT(userId) DO UPDATE SET inicio = excluded.inicio, vencimiento = excluded.vencimiento, comprado = excluded.comprado`,
        ).run(String(userId), inicio, vencimiento, ahora);
        return true;
    })();
    if (!ok) return { ok: false, motivo: "saldo", cfg };
    log.info(`${userId} ${activo ? "renovó" : "compró"} el seguro antirrobo (${cfg.precio}) hasta ${new Date(vencimiento).toISOString()}`);
    return { ok: true, precio: cfg.precio, vencimiento, extendido: activo, cfg };
}

/** Lo que se aplica al resolver un robo: `null` sin seguro; si lo hay, probabilidad de fallo y reducción del botín. */
function proteccion(userId, ahora = Date.now()) {
    return estado(userId, ahora).activo ? { probFallo: PROB_FALLO, reduccion: REDUCCION } : null;
}

module.exports = {
    DEFECTOS,
    HORA_MS,
    DIA_MS,
    PROB_FALLO,
    REDUCCION,
    config,
    estado,
    comprar,
    proteccion,
};
