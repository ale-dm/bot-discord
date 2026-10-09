// 🧙 Préstamos del Duende (F-DU-03, #14). El Duende los ofrece desde el chat, pero el dinero solo se mueve cuando la
// persona lo acepta con el botón (paneles/duendeEconomia). Como la banca del casino, el Duende no tiene saldo: lo que
// presta se crea y lo que se le devuelve desaparece.
// - Uno a la vez, de MIN a MAX monedas, y se devuelve con un INTERES % en PLAZO_DIAS días (antes, cuando se quiera,
//   desde /perfil → 💰 Economía).
// - Al vencer (cron) se cobra solo: del efectivo y, si no llega, del banco. Lo que falte queda como deuda (estado
//   'deuda'): se va cobrando de lo que gane (dinero.pagarConImpuesto llama a cobrarDeuda) y, mientras dure, no puede
//   pedir otro préstamo ni apostar contra el Duende (systems/retos).
const db = require("../core/db");
const dinero = require("./dinero");
const { createLogger } = require("../core/logger");
const { fmtNumero } = require("../core/formato");

const log = createLogger("Prestamos");

const MIN = 10;
const MAX = 1000;
/** % que se devuelve de más. */
const INTERES = 10;
const PLAZO_DIAS = 7;
const DIA_MS = 24 * 3600 * 1000;

/** Lo que hay que devolver por un préstamo de `cantidad` (con el interés, redondeado hacia arriba). */
const totalDe = (cantidad) => Math.ceil((cantidad * (100 + INTERES)) / 100);

/** El préstamo sin cerrar de alguien (activo o en deuda), con lo que le `falta` por devolver; null si no tiene. */
function abierto(userId) {
    const p = db
        .prepare("SELECT * FROM prestamos_duende WHERE userId = ? AND estado IN ('activo', 'deuda') ORDER BY id DESC LIMIT 1")
        .get(String(userId));
    return p ? { ...p, falta: p.total - p.pagado } : null;
}

/** Si tiene una deuda con el Duende: un préstamo vencido sin pagar entero. */
const enDeuda = (userId) => abierto(userId)?.estado === "deuda";

/** Por qué no se le pueden prestar `cantidad` monedas a alguien, o null si se puede. */
function motivoNoPrestar(userId, cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < MIN || cantidad > MAX) {
        return `La cantidad tiene que ser un número entero entre ${MIN} y ${fmtNumero(MAX)}.`;
    }
    const p = abierto(userId);
    if (p?.estado === "deuda") return `Debes **${fmtNumero(p.falta)}** 🪙 de un préstamo vencido: hasta saldarlo no hay otro.`;
    if (p) return `Ya tienes un préstamo: devuelve los **${fmtNumero(p.falta)}** 🪙 antes de pedir otro.`;
    return null;
}

/** Acepta un préstamo: se apunta y se le paga al efectivo. */
function aceptar(userId, cantidad, guildId = null, ahora = Date.now()) {
    return db.transaction(() => {
        const motivo = motivoNoPrestar(userId, cantidad);
        if (motivo) return { ok: false, mensaje: `❌ ${motivo}` };
        const total = totalDe(cantidad);
        db.prepare("INSERT INTO prestamos_duende (userId, guildId, cantidad, total, creado_en, vence_en) VALUES (?, ?, ?, ?, ?, ?)").run(
            String(userId),
            guildId,
            cantidad,
            total,
            ahora,
            ahora + PLAZO_DIAS * DIA_MS,
        );
        dinero.pagar(userId, cantidad);
        dinero.apuntar(userId, "prestamo", `Préstamo del Duende (devuelves ${fmtNumero(total)})`, cantidad);
        log.info(`${userId} acepta un préstamo de ${cantidad} (devuelve ${total})`);
        return { ok: true, prestamo: abierto(userId) };
    })();
}

/** Suma `cantidad` a lo pagado y lo cierra si ya está todo. */
function registrarPago(p, cantidad, ahora) {
    const pagado = p.pagado + cantidad;
    const devuelto = pagado >= p.total;
    db.prepare("UPDATE prestamos_duende SET pagado = ?, estado = ?, cerrado_en = ? WHERE id = ?").run(
        pagado,
        devuelto ? "devuelto" : p.estado,
        devuelto ? ahora : null,
        p.id,
    );
}

/** Devuelve todo lo que falta del préstamo, del efectivo (antes de que venza o con la deuda). */
function devolver(userId, ahora = Date.now()) {
    return db.transaction(() => {
        const p = abierto(userId);
        if (!p) return { ok: false, mensaje: "❌ No tienes ningún préstamo del Duende." };
        if (!dinero.cobrar(userId, p.falta)) {
            return {
                ok: false,
                mensaje: `❌ Para devolver los **${fmtNumero(p.falta)}** 🪙 te faltan **${fmtNumero(p.falta - dinero.efectivo(userId))}** 🪙 de efectivo. Saca del banco primero.`,
            };
        }
        dinero.apuntar(userId, "prestamo", "Devolución del préstamo del Duende", -p.falta);
        registrarPago(p, p.falta, ahora);
        log.info(`${userId} devuelve su préstamo (${p.falta})`);
        return { ok: true, mensaje: `🧙 Has devuelto el préstamo del Duende: **${fmtNumero(p.falta)}** 🪙.` };
    })();
}

/**
 * Cron: cobra los préstamos que han vencido, primero del efectivo y luego del banco (en Movimientos, cada parte con de
 * dónde salió). Lo que no llega queda como deuda.
 * @returns {Array<{userId, cobrado, falta}>} lo cobrado a cada uno y lo que se le queda debiendo
 */
function vencer(ahora = Date.now()) {
    const cobros = [];
    for (const { id } of db.prepare("SELECT id FROM prestamos_duende WHERE estado = 'activo' AND vence_en <= ?").all(ahora)) {
        const r = db.transaction(() => {
            const p = db.prepare("SELECT * FROM prestamos_duende WHERE id = ? AND estado = 'activo'").get(id);
            if (!p) return null;
            let falta = p.total - p.pagado;
            const c = dinero.cuenta(p.userId);
            const deEfectivo = Math.min(falta, c.efectivo);
            if (deEfectivo > 0 && dinero.cobrar(p.userId, deEfectivo)) {
                dinero.apuntar(p.userId, "prestamo", "Cobro del préstamo vencido del Duende (del efectivo)", -deEfectivo);
                falta -= deEfectivo;
            }
            const deBanco = Math.min(falta, c.banco);
            if (deBanco > 0 && dinero.cobrarBanco(p.userId, deBanco)) {
                dinero.apuntar(p.userId, "prestamo", "Cobro del préstamo vencido del Duende (del banco)", -deBanco);
                falta -= deBanco;
            }
            const cobrado = p.total - p.pagado - falta;
            db.prepare("UPDATE prestamos_duende SET pagado = ?, estado = ?, cerrado_en = ? WHERE id = ?").run(
                p.pagado + cobrado,
                falta > 0 ? "deuda" : "devuelto",
                falta > 0 ? null : ahora,
                p.id,
            );
            return { userId: p.userId, cobrado, falta };
        })();
        if (r) cobros.push(r);
    }
    if (cobros.length) log.info(`Préstamos vencidos: ${cobros.map((c) => `${c.userId} -${c.cobrado} (debe ${c.falta})`).join(", ")}`);
    return cobros;
}

/**
 * Lo que acaba de ganar alguien (ya sin su impuesto) paga primero su deuda con el Duende, si tiene: lo llama
 * dinero.pagarConImpuesto. @returns {number} lo cobrado
 */
function cobrarDeuda(userId, maximo) {
    if (!(maximo > 0)) return 0;
    const p = db.prepare("SELECT * FROM prestamos_duende WHERE userId = ? AND estado = 'deuda' LIMIT 1").get(String(userId));
    if (!p) return 0;
    const cantidad = Math.min(p.total - p.pagado, maximo, dinero.efectivo(userId));
    if (cantidad <= 0 || !dinero.cobrar(userId, cantidad)) return 0;
    dinero.apuntar(userId, "prestamo", "Cobro de la deuda con el Duende", -cantidad);
    registrarPago(p, cantidad, Date.now());
    return cantidad;
}

module.exports = {
    MIN,
    MAX,
    INTERES,
    PLAZO_DIAS,
    totalDe,
    abierto,
    enDeuda,
    motivoNoPrestar,
    aceptar,
    devolver,
    vencer,
    cobrarDeuda,
};
