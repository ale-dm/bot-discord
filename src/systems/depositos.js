// Depósito a plazo (F-EC-13, #518): se guarda dinero del banco durante 7, 30 o 90 días a cambio de un
// interés. Al vencer vuelve solo al banco (principal + interés); cancelarlo antes devuelve el principal y
// pierde el interés. Una persona solo puede tener uno activo. El dinero se mueve por systems/dinero.
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Depósitos");
const DIA_MS = 24 * 60 * 60 * 1000;
const PLAZOS = [7, 30, 90];
const DEFECTOS = { min: 1000, max: 100000, pct: { 7: 1, 30: 3, 90: 6 } };

function entero(valor, defecto, min, max) {
    const n = Number(valor);
    return Number.isInteger(n) && n >= min && n <= max ? n : defecto;
}

/** Mínimo, máximo y porcentaje de cada plazo, según los ajustes del servidor (con los valores de la issue). */
function config(guildId) {
    const e = (guildId && guildSettings.getSettings(guildId).economia) || {};
    const min = entero(e.deposito_min, DEFECTOS.min, 1, 1_000_000);
    return {
        min,
        max: entero(e.deposito_max, Math.max(min, DEFECTOS.max), min, 1_000_000),
        pct: {
            7: entero(e.deposito_pct_7, DEFECTOS.pct[7], 0, 100),
            30: entero(e.deposito_pct_30, DEFECTOS.pct[30], 0, 100),
            90: entero(e.deposito_pct_90, DEFECTOS.pct[90], 0, 100),
        },
    };
}

const filaActiva = (userId) =>
    db
        .prepare(
            "SELECT id, userId, importe, interes, dias, inicio, vencimiento FROM depositos_plazo WHERE userId = ? AND estado = 'activo'",
        )
        .get(String(userId));

/** El depósito activo de alguien ({...} con total y restanteMs), o null. */
function estado(userId, ahora = Date.now()) {
    const f = filaActiva(userId);
    if (!f) return null;
    return {
        ...f,
        total: f.importe + f.interes,
        restanteMs: Math.max(0, f.vencimiento - ahora),
        vencido: f.vencimiento <= ahora,
    };
}

/**
 * Abre un depósito con dinero del banco. Un solo activo por persona; el interés se calcula al abrirlo.
 * @returns {{ok:true, deposito:object} | {ok:false, motivo:"activo"|"plazo"|"importe"|"saldo"}}
 */
function crear(userId, guildId, importe, dias, ahora = Date.now()) {
    const cfg = config(guildId);
    if (filaActiva(userId)) return { ok: false, motivo: "activo" };
    if (!PLAZOS.includes(dias)) return { ok: false, motivo: "plazo" };
    if (!Number.isInteger(importe) || importe < cfg.min || importe > cfg.max) return { ok: false, motivo: "importe" };
    if (dinero.banco(userId) < importe) return { ok: false, motivo: "saldo" };

    const interes = Math.floor((importe * cfg.pct[dias]) / 100);
    const vencimiento = ahora + dias * DIA_MS;
    const ok = db.transaction(() => {
        if (!dinero.cobrarBanco(userId, importe)) return false;
        dinero.apuntar(userId, "banco", `Apertura de depósito (${dias} días)`, -importe);
        db.prepare(
            `INSERT INTO depositos_plazo (userId, importe, interes, dias, inicio, vencimiento, estado)
             VALUES (?, ?, ?, ?, ?, ?, 'activo')`,
        ).run(String(userId), importe, interes, dias, ahora, vencimiento);
        return true;
    })();
    if (!ok) return { ok: false, motivo: "saldo" };
    log.info(`${userId} abrió un depósito de ${importe} a ${dias} días (interés ${interes})`);
    return { ok: true, deposito: { userId: String(userId), importe, interes, dias, inicio: ahora, vencimiento } };
}

/**
 * Cancela antes de tiempo: devuelve el principal al banco y no paga intereses.
 * @returns {{ok:true, deposito:object} | {ok:false, motivo:"sin"|"vencido"}}
 */
function cancelar(userId, ahora = Date.now()) {
    const f = filaActiva(userId);
    if (!f) return { ok: false, motivo: "sin" };
    if (f.vencimiento <= ahora) return { ok: false, motivo: "vencido" };
    const ok = db.transaction(() => {
        const r = db
            .prepare("UPDATE depositos_plazo SET estado = 'cancelado', cerrado = ? WHERE id = ? AND estado = 'activo'")
            .run(ahora, f.id);
        if (r.changes !== 1) return false;
        dinero.pagarBanco(userId, f.importe);
        dinero.apuntar(userId, "banco", `Depósito cancelado (${f.dias} días)`, f.importe);
        return true;
    })();
    if (!ok) return { ok: false, motivo: "sin" };
    log.info(`${userId} canceló el depósito de ${f.importe} a ${f.dias} días`);
    return { ok: true, deposito: f };
}

/**
 * Paga los depósitos vencidos (principal + interés) y los marca como pagados. Idempotente: el UPDATE con
 * estado = 'activo' impide pagar dos veces el mismo. Devuelve los que se han pagado ahora.
 * @returns {Array<{userId:string, importe:number, interes:number, total:number, dias:number}>}
 */
function procesarVencidos(ahora = Date.now()) {
    const filas = db
        .prepare(
            "SELECT id, userId, importe, interes, dias FROM depositos_plazo WHERE estado = 'activo' AND vencimiento <= ? ORDER BY vencimiento",
        )
        .all(ahora);
    const pagados = [];
    for (const f of filas) {
        const ok = db.transaction(() => {
            const r = db
                .prepare("UPDATE depositos_plazo SET estado = 'pagado', cerrado = ? WHERE id = ? AND estado = 'activo'")
                .run(ahora, f.id);
            if (r.changes !== 1) return false;
            const total = f.importe + f.interes;
            dinero.pagarBanco(f.userId, total);
            dinero.apuntar(f.userId, "banco", `Depósito vencido (${f.dias} días)`, total);
            return true;
        })();
        if (ok) {
            pagados.push({ userId: f.userId, importe: f.importe, interes: f.interes, total: f.importe + f.interes, dias: f.dias });
            log.info(`${f.userId}: depósito vencido pagado (${f.importe} + ${f.interes})`);
        }
    }
    return pagados;
}

module.exports = { DIA_MS, PLAZOS, DEFECTOS, config, estado, crear, cancelar, procesarVencidos };
