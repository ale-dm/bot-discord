// Motor de impuestos (F-EC-06a): reglas configurables por servidor, en vez de un % fijo en el
// código. Dos bases: "ingreso" (sobre lo que entra, opcionalmente limitada a un tipo concreto de
// dinero.TIPOS) y "compra" (al gastar en la tienda). Gestionado desde Panel admin → Config Global
// → Economía → Impuestos.
const db = require("../core/db");

const PORCENTAJE_POR_DEFECTO = 5;

// Tipos de historial que nunca pagan impuesto de ingreso: mover dinero propio (banco) o entre
// jugadores (transferencia), y correcciones de admin — no son "ingresos" de verdad. El dinero
// negro (F-EC-06b) se añadirá aquí cuando exista esa columna/tipo.
// Un préstamo del Duende (F-DU-03) tampoco es un ingreso: se devuelve.
const TIPOS_EXCLUIDOS = ["transferencia", "banco", "admin", "prestamo"];

function aRegla(r) {
    if (!r) return null;
    return {
        id: r.id,
        guildId: r.guildId,
        base: r.base,
        tipoMovimiento: r.tipoMovimiento,
        porcentaje: r.porcentaje,
        activo: !!r.activo,
        destino: r.destino,
        creadoEn: r.creadoEn,
    };
}

function listarReglas(guildId) {
    return db
        .prepare("SELECT * FROM impuestos_reglas WHERE guildId = ? ORDER BY base, tipoMovimiento IS NULL DESC, id")
        .all(guildId)
        .map(aRegla);
}

/** Si el servidor no tiene ninguna regla todavía, siembra la de por defecto (5% sobre ingresos, al bote). */
function asegurarReglaPorDefecto(guildId) {
    const existe = db.prepare("SELECT 1 FROM impuestos_reglas WHERE guildId = ?").get(guildId);
    if (existe) return;
    anadirRegla(guildId, { base: "ingreso", tipoMovimiento: null, porcentaje: PORCENTAJE_POR_DEFECTO, destino: "bote" });
}

function anadirRegla(guildId, { base, tipoMovimiento = null, porcentaje, destino = "bote" }) {
    const info = db
        .prepare(
            "INSERT INTO impuestos_reglas (guildId, base, tipoMovimiento, porcentaje, activo, destino, creadoEn) VALUES (?, ?, ?, ?, 1, ?, ?)",
        )
        .run(guildId, base, tipoMovimiento, porcentaje, destino, Date.now());
    return aRegla(db.prepare("SELECT * FROM impuestos_reglas WHERE id = ?").get(info.lastInsertRowid));
}

function quitarRegla(guildId, id) {
    return db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ? AND id = ?").run(guildId, id).changes === 1;
}

function activarRegla(guildId, id, activo) {
    return db.prepare("UPDATE impuestos_reglas SET activo = ? WHERE guildId = ? AND id = ?").run(activo ? 1 : 0, guildId, id).changes === 1;
}

/** La regla de ingreso que aplica a ese tipo: la específica si existe y está activa; si no, la general; si no, null. */
function reglaDeIngreso(guildId, tipo) {
    const especifica = db
        .prepare("SELECT * FROM impuestos_reglas WHERE guildId = ? AND base = 'ingreso' AND tipoMovimiento = ? AND activo = 1")
        .get(guildId, tipo);
    if (especifica) return aRegla(especifica);
    return aRegla(
        db
            .prepare("SELECT * FROM impuestos_reglas WHERE guildId = ? AND base = 'ingreso' AND tipoMovimiento IS NULL AND activo = 1")
            .get(guildId),
    );
}

/** @returns {{impuesto: number, destino: string, reglaId: number}|null} null si no aplica ninguna regla, el tipo está excluido, o no se sabe de qué servidor es (reto antiguo sin guildId, etc.). */
function calcularImpuesto(guildId, tipo, cantidad) {
    if (!guildId || TIPOS_EXCLUIDOS.includes(tipo)) return null;
    asegurarReglaPorDefecto(guildId);
    const regla = reglaDeIngreso(guildId, tipo);
    if (!regla) return null;
    const impuesto = Math.floor((cantidad * regla.porcentaje) / 100);
    if (impuesto <= 0) return null;
    return { impuesto, destino: regla.destino, reglaId: regla.id };
}

/** La regla de compra activa, si hay alguna (no tiene ámbito por tipo: una sola regla general de compra). */
function impuestoDeCompra(guildId, cantidad) {
    if (!guildId) return null;
    asegurarReglaPorDefecto(guildId);
    const regla = aRegla(db.prepare("SELECT * FROM impuestos_reglas WHERE guildId = ? AND base = 'compra' AND activo = 1").get(guildId));
    if (!regla) return null;
    const impuesto = Math.floor((cantidad * regla.porcentaje) / 100);
    if (impuesto <= 0) return null;
    return { impuesto, destino: regla.destino, reglaId: regla.id };
}

function sumarBote(guildId, cantidad) {
    db.prepare(
        "INSERT INTO impuestos_bote (guildId, total) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET total = total + excluded.total",
    ).run(guildId, cantidad);
}

function boteTotal(guildId) {
    return db.prepare("SELECT total FROM impuestos_bote WHERE guildId = ?").pluck().get(guildId) || 0;
}

module.exports = {
    TIPOS_EXCLUIDOS,
    listarReglas,
    asegurarReglaPorDefecto,
    anadirRegla,
    quitarRegla,
    activarRegla,
    calcularImpuesto,
    impuestoDeCompra,
    sumarBote,
    boteTotal,
};
