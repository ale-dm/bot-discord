// El dinero de cada uno, en dos sitios (tabla `banco`):
// - 💵 Efectivo (columna `enMano`): lo que se gasta. Casino, apuestas, quiniela, tienda, cripto y
//   transferencias cobran de aquí, y los premios, reembolsos, ventas y recompensas llegan aquí.
// - 🏦 Banco (columna `saldo`): el sitio seguro. Solo se ingresa y se saca; no se gasta directamente.
// Todo movimiento de dinero pasa por este módulo, y se apunta en el historial con su `tipo` (para filtrar
// los movimientos). Antes cada sistema hacía su propio UPDATE sobre el saldo del banco.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Dinero");

/** Con lo que empieza cada uno, en efectivo (para poder jugar nada más llegar). */
const INICIAL = 1000;
/** Máximo por operación de banco o transferencia. */
const LIMITE_OPERACION = 1_000_000;

// Tipos de movimiento del historial (columna `tipo`), con cómo se enseñan en Movimientos.
const TIPOS = {
    casino: "🎰 Casino",
    apuestas: "⚽ Apuestas",
    tienda: "🛒 Tienda",
    cripto: "📈 Cripto",
    banco: "🏦 Banco",
    transferencia: "💸 Transferencias",
    logro: "🏅 Logros",
    diario: "🎁 Diario",
    objeto: "🎒 Objetos",
    admin: "🛠️ Admin",
    otro: "📦 Otros",
};

function asegurarCuenta(userId) {
    db.prepare("INSERT OR IGNORE INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(String(userId), INICIAL);
}

/** { efectivo, banco, total } de alguien (le crea la cuenta si no la tenía). */
function cuenta(userId) {
    asegurarCuenta(userId);
    const r = db.prepare("SELECT saldo, enMano FROM banco WHERE userId = ?").get(String(userId));
    const efectivo = Number(r?.enMano || 0);
    const banco = Number(r?.saldo || 0);
    return { efectivo, banco, total: efectivo + banco };
}

const efectivo = (userId) => cuenta(userId).efectivo;
const banco = (userId) => cuenta(userId).banco;

/** Apunta un movimiento en el historial. `cantidad` es lo que cambia el efectivo (o el banco, si tipo=banco). */
function apuntar(userId, tipo, descripcion, cantidad) {
    db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, ?)").run(
        String(userId),
        new Date().toISOString(),
        descripcion,
        cantidad,
        TIPOS[tipo] ? tipo : "otro",
    );
}

/**
 * Cobra del efectivo, solo si alcanza (en una sola sentencia: dos cobros a la vez no pueden dejarlo en
 * negativo). No apunta nada: lo hace quien cobra, con su descripción. @returns {boolean}
 */
function cobrar(userId, cantidad) {
    asegurarCuenta(userId);
    return (
        db.prepare("UPDATE banco SET enMano = enMano - ? WHERE userId = ? AND enMano >= ?").run(cantidad, String(userId), cantidad)
            .changes === 1
    );
}

/** Suma al efectivo (premios, reembolsos, ventas, recompensas). No apunta nada. */
function pagar(userId, cantidad) {
    asegurarCuenta(userId);
    db.prepare("UPDATE banco SET enMano = enMano + ? WHERE userId = ?").run(cantidad, String(userId));
}

function validarCantidad(cantidad) {
    if (!Number.isInteger(cantidad) || cantidad <= 0) return "La cantidad tiene que ser un número entero mayor que cero.";
    if (cantidad > LIMITE_OPERACION) return `Como mucho ${LIMITE_OPERACION.toLocaleString("es")} monedas por operación.`;
    return null;
}

/** Mueve dinero entre efectivo y banco. `haciaBanco`: ingresar; si no, sacar. */
function mover(userId, cantidad, haciaBanco) {
    const error = validarCantidad(cantidad);
    if (error) return { ok: false, mensaje: `❌ ${error}` };
    asegurarCuenta(userId);
    const ok = db.transaction(() => {
        const r = haciaBanco
            ? db.prepare("UPDATE banco SET enMano = enMano - ?, saldo = saldo + ? WHERE userId = ? AND enMano >= ?")
            : db.prepare("UPDATE banco SET saldo = saldo - ?, enMano = enMano + ? WHERE userId = ? AND saldo >= ?");
        if (r.run(cantidad, cantidad, String(userId), cantidad).changes !== 1) return false;
        // Desde el efectivo: ingresar lo quita, sacar lo pone.
        apuntar(userId, "banco", haciaBanco ? "Ingreso en el banco" : "Retirada del banco", haciaBanco ? -cantidad : cantidad);
        return true;
    })();
    if (!ok) {
        return {
            ok: false,
            mensaje: haciaBanco ? "❌ No tienes tanto efectivo para ingresar." : "❌ No tienes tanto dinero en el banco.",
        };
    }
    log.info(`${userId} ${haciaBanco ? "ingresó" : "sacó"} ${cantidad}`);
    return {
        ok: true,
        mensaje: haciaBanco
            ? `🏦 Has ingresado **${cantidad.toLocaleString("es")}** 🪙.`
            : `💵 Has sacado **${cantidad.toLocaleString("es")}** 🪙.`,
        cuenta: cuenta(userId),
    };
}

const ingresar = (userId, cantidad) => mover(userId, cantidad, true);
const sacar = (userId, cantidad) => mover(userId, cantidad, false);

/** Transferencia de efectivo a efectivo, todo o nada. `nombres`: { de, a } para el historial. */
function transferir(deId, aId, cantidad, nombres = {}) {
    const error = validarCantidad(cantidad);
    if (error) return { ok: false, mensaje: `❌ ${error}` };
    if (String(deId) === String(aId)) return { ok: false, mensaje: "❌ No puedes transferirte dinero a ti mismo." };
    asegurarCuenta(aId);
    const ok = db.transaction(() => {
        if (!cobrar(deId, cantidad)) return false;
        pagar(aId, cantidad);
        apuntar(deId, "transferencia", `Transferencia a ${nombres.a || aId}`, -cantidad);
        apuntar(aId, "transferencia", `Transferencia recibida de ${nombres.de || deId}`, cantidad);
        return true;
    })();
    if (!ok) return { ok: false, mensaje: "❌ No tienes tanto efectivo. Saca dinero del banco primero." };
    log.info(`${deId} transfirió ${cantidad} a ${aId}`);
    return {
        ok: true,
        mensaje: `💸 Has transferido **${cantidad.toLocaleString("es")}** 🪙 a **${nombres.a || aId}**.`,
        cuenta: cuenta(deId),
    };
}

/** Movimientos del historial, más recientes primero; con `tipo`, solo de ese tipo. */
function movimientos(userId, { tipo = null, limite = 10, offset = 0 } = {}) {
    const filtro = tipo ? " AND tipo = ?" : "";
    const params = tipo ? [String(userId), tipo] : [String(userId)];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM historial WHERE userId = ?${filtro}`).get(...params).n;
    const filas = db
        .prepare(
            `SELECT fecha, descripcion, cantidad, tipo FROM historial WHERE userId = ?${filtro} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limite, offset);
    return { total, filas };
}

/** Los más ricos, contando efectivo y banco. */
function masRicos(limite = 10) {
    return db
        .prepare("SELECT userId, enMano AS efectivo, saldo AS banco, enMano + saldo AS total FROM banco ORDER BY total DESC LIMIT ?")
        .all(limite);
}

module.exports = {
    INICIAL,
    LIMITE_OPERACION,
    TIPOS,
    asegurarCuenta,
    cuenta,
    efectivo,
    banco,
    apuntar,
    cobrar,
    pagar,
    ingresar,
    sacar,
    transferir,
    movimientos,
    masRicos,
};
