// 📊 Tramos de una regla de impuesto de ingreso (#392): la parte de cada ingreso que cae dentro de un tramo paga su propio
// porcentaje. El porcentaje de la regla vale desde 0; cada tramo extra empieza en `desde` (monedas) y llega hasta el siguiente.
// Un tramo puede ser del 0 % (deja exentas las cantidades pequeñas si la regla es del 0 %). Los tramos se miden sobre el ingreso
// de una sola operación. Una regla sin tramos da el mismo impuesto de siempre.
const db = require("../../core/db");

/** Los tramos extra de una regla, de menor a mayor `desde`. */
function tramosDe(reglaId) {
    return db.prepare("SELECT desde, porcentaje FROM impuestos_tramos WHERE reglaId = ? ORDER BY desde").all(reglaId);
}

/** El impuesto (entero, hacia abajo) de `cantidad` según la regla y sus tramos. */
function impuestoDe(regla, cantidad) {
    const tramos = [{ desde: 0, porcentaje: regla.porcentaje }, ...tramosDe(regla.id)];
    if (tramos.length === 1) return Math.floor((cantidad * regla.porcentaje) / 100);
    let total = 0;
    tramos.forEach((t, i) => {
        const hasta = i + 1 < tramos.length ? tramos[i + 1].desde : Infinity;
        const parte = Math.max(0, Math.min(cantidad, hasta) - t.desde);
        total += (parte * t.porcentaje) / 100;
    });
    return Math.floor(total);
}

/** Añade (o cambia) un tramo de una regla de ingreso del servidor. @returns {{ ok: boolean, mensaje: string }} */
function ponerTramo(guildId, reglaId, desde, porcentaje) {
    const regla = db.prepare("SELECT id, base FROM impuestos_reglas WHERE guildId = ? AND id = ?").get(guildId, reglaId);
    if (!regla) return { ok: false, mensaje: `❌ No hay ninguna regla #${reglaId} en este servidor.` };
    if (regla.base !== "ingreso") return { ok: false, mensaje: "❌ Solo las reglas de ingreso tienen tramos." };
    if (!Number.isInteger(desde) || desde < 1)
        return { ok: false, mensaje: "❌ El tramo empieza en 1 moneda o más (el primero es el de la regla)." };
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        return { ok: false, mensaje: "❌ El porcentaje tiene que ser un número entre 0 y 100." };
    }
    db.prepare(
        "INSERT INTO impuestos_tramos (reglaId, desde, porcentaje) VALUES (?, ?, ?) ON CONFLICT(reglaId, desde) DO UPDATE SET porcentaje = excluded.porcentaje",
    ).run(reglaId, desde, porcentaje);
    return { ok: true, mensaje: `✅ Regla #${reglaId}: a partir de ${desde.toLocaleString("es")} 🪙 paga el ${porcentaje} %.` };
}

/** Quita un tramo de una regla del servidor. */
function quitarTramo(guildId, reglaId, desde) {
    if (!db.prepare("SELECT 1 FROM impuestos_reglas WHERE guildId = ? AND id = ?").get(guildId, reglaId)) return false;
    return db.prepare("DELETE FROM impuestos_tramos WHERE reglaId = ? AND desde = ?").run(reglaId, desde).changes === 1;
}

/** Borra todos los tramos de una regla (al quitar la regla). */
const borrarTramos = (reglaId) => db.prepare("DELETE FROM impuestos_tramos WHERE reglaId = ?").run(reglaId);

module.exports = { tramosDe, impuestoDe, ponerTramo, quitarTramo, borrarTramos };
