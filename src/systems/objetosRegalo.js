// 🎁 Regalar un objeto del inventario a otra persona (#302): solo cambia de dueño la fila del inventario, las monedas no se
// mueven. Los objetos de protección (antirrobo y trampa) no salen de su dueño por esta vía ni por el mercado.
const db = require("../core/db");
const dinero = require("./dinero");
const { efectoProteccion } = require("./robar");

/** El objeto es de protección contra /robar (antirrobo o trampa): se queda con quien lo tiene. */
const esDeProteccion = (obj) => Boolean(obj?.efecto && efectoProteccion(obj.efecto));

/** La fila del inventario de alguien (la más antigua) de un objeto, con los datos del objeto, o undefined. */
function unidadDe(userId, objetoId) {
    return db
        .prepare(
            `SELECT inventario.id AS inventarioId, objeto.* FROM inventario JOIN objeto ON inventario.itemId = objeto.id
             WHERE inventario.userId = ? AND objeto.id = ? ORDER BY inventario.id ASC LIMIT 1`,
        )
        .get(String(userId), objetoId);
}

/** ¿Puede alguien recibir este objeto? Un objeto único no se puede tener dos veces. */
function puedeRecibir(userId, obj) {
    return !(obj.unico && db.prepare("SELECT 1 FROM inventario WHERE userId = ? AND itemId = ?").get(String(userId), obj.id));
}

/**
 * Regala una unidad de un objeto. Todo o nada. `nombres`: { de, a } para el historial.
 * @returns {{ ok: boolean, mensaje: string, objeto?: object }}
 */
function regalar(deId, aId, objetoId, nombres = {}) {
    if (String(deId) === String(aId)) return { ok: false, mensaje: "❌ No puedes regalarte un objeto a ti mismo." };
    return db.transaction(() => {
        const unidad = unidadDe(deId, objetoId);
        if (!unidad) return { ok: false, mensaje: "❌ Ya no tienes ese objeto." };
        if (esDeProteccion(unidad))
            return { ok: false, mensaje: `❌ **${unidad.nombre}** es un objeto de protección: no se puede regalar.` };
        if (!puedeRecibir(aId, unidad)) {
            return { ok: false, mensaje: `❌ **${nombres.a || aId}** ya tiene **${unidad.nombre}** y es un objeto único.` };
        }
        const r = db
            .prepare("UPDATE inventario SET userId = ? WHERE id = ? AND userId = ?")
            .run(String(aId), unidad.inventarioId, String(deId));
        if (r.changes !== 1) return { ok: false, mensaje: "❌ Ya no tienes ese objeto." };
        dinero.apuntar(deId, "objeto", `Regalo a ${nombres.a || aId}: ${unidad.nombre}`, 0);
        dinero.apuntar(aId, "objeto", `Regalo de ${nombres.de || deId}: ${unidad.nombre}`, 0);
        return { ok: true, mensaje: `🎁 Has regalado **${unidad.nombre}** a **${nombres.a || aId}**.`, objeto: unidad };
    })();
}

module.exports = { esDeProteccion, unidadDe, puedeRecibir, regalar };
