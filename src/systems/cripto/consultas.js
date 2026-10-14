// Consultas de TTCL de una persona (historial, coste medio) y de la cartera de todos (quién tiene más). Solo leen: se re-exportan desde mercado.
const db = require("../../core/db");

/** Movimientos de TTCL de alguien, más recientes primero, paginados. */
function historialTtcl(userId, limite, offset) {
    return db
        .prepare(
            "SELECT tipo, cantidad, precio, monedas, comision, timestamp FROM cripto_historial WHERE userId = ? AND cripto = 'TTCL' ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
        )
        .all(String(userId), limite, offset);
}

function totalHistorialTtcl(userId) {
    return db.prepare("SELECT COUNT(*) AS n FROM cripto_historial WHERE userId = ? AND cripto = 'TTCL'").get(String(userId)).n;
}

/** Coste medio por TTCL de las compras de alguien (lo pagado entre lo comprado). 0 si nunca ha comprado. */
function costeMedioTtcl(userId) {
    const r = db
        .prepare(
            "SELECT COALESCE(SUM(cantidad), 0) AS unidades, COALESCE(SUM(monedas), 0) AS pagado FROM cripto_historial WHERE userId = ? AND cripto = 'TTCL' AND tipo = 'compra'",
        )
        .get(String(userId));
    return r.unidades > 0 ? r.pagado / r.unidades : 0;
}

/** Quien más TTCL tiene en cartera. */
function topTenedoresTtcl(limite = 5) {
    return db
        .prepare("SELECT userId, cantidad FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0 ORDER BY cantidad DESC LIMIT ?")
        .all(limite);
}

module.exports = { historialTtcl, totalHistorialTtcl, costeMedioTtcl, topTenedoresTtcl };
