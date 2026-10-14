// 💰 Vender un objeto del inventario a la tienda (#379): devuelve al efectivo un % del precio base del catálogo
// (`tienda.recompra_pct`, 50 % por defecto, 0 = la tienda no recompra) y deja la unidad en la tienda (si el stock era limitado, sube).
// El porcentaje es global del servidor, no por objeto. Los objetos únicos se pueden vender y volver a comprar.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const dinero = require("./dinero");
const { unidadDe } = require("./objetosRegalo");

/** Cuántas monedas da la tienda por un objeto a la venta (sobre su precio base, no el de oferta ni el dinámico), o null si no lo recompra. */
function precioDeRecompra(guildId, objetoId) {
    const pct = Number(guildSettings.getSettings(guildId).tienda.recompra_pct || 0);
    if (!(pct > 0)) return null;
    const venta = db.prepare("SELECT precio, precio_base FROM tienda WHERE objetoId = ?").get(objetoId);
    if (!venta) return null;
    return Math.floor(((venta.precio_base ?? venta.precio) * pct) / 100);
}

/** @returns {{ ok: boolean, mensaje: string, monedas?: number }} */
function venderATienda(userId, guildId, objetoId) {
    if (!(Number(guildSettings.getSettings(guildId).tienda.recompra_pct || 0) > 0)) {
        return { ok: false, mensaje: "❌ La tienda no recompra objetos en este servidor." };
    }
    return db.transaction(() => {
        const unidad = unidadDe(userId, objetoId);
        if (!unidad) return { ok: false, mensaje: "❌ No tienes ese objeto." };
        const monedas = precioDeRecompra(guildId, objetoId);
        if (monedas === null) return { ok: false, mensaje: `❌ La tienda ya no vende **${unidad.nombre}**, así que no lo recompra.` };
        db.prepare("DELETE FROM inventario WHERE id = ?").run(unidad.inventarioId);
        db.prepare("UPDATE tienda SET stock = stock + 1 WHERE objetoId = ? AND stock IS NOT NULL").run(objetoId);
        dinero.pagarSinImpuesto(userId, "venta", `Venta a la tienda: ${unidad.nombre}`, monedas);
        return {
            ok: true,
            mensaje: `💰 Has vendido **${unidad.nombre}** a la tienda por **${monedas.toLocaleString("es")}** 🪙.`,
            monedas,
        };
    })();
}

module.exports = { precioDeRecompra, venderATienda };
