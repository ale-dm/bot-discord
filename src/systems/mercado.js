// 🏷️ Mercado de objetos entre jugadores (#374): se pone un objeto del inventario a precio fijo y otra persona lo compra con su
// efectivo. Mientras está a la venta el objeto sale del inventario del vendedor; al retirarlo o caducar la oferta (7 días)
// vuelve a él. El precio llega íntegro al vendedor: sin comisión ni impuesto (como las ventas de cripto, #119). Se paga solo
// con efectivo (no con dinero negro, que así no se blanquearía por aquí).
const db = require("../core/db");
const dinero = require("./dinero");
const { esDeProteccion, unidadDe, puedeRecibir } = require("./objetosRegalo");
const { fmtNumero } = require("../core/formato");

const CADUCIDAD_MS = 7 * 24 * 3600 * 1000;
const MAX_OFERTAS = 10;
const PRECIO_MAX = 1_000_000;

const SELECT_OFERTA = `SELECT mercado_ofertas.*, objeto.nombre, objeto.descripcion, objeto.tipo, objeto.rareza, objeto.imagen, objeto.unico
    FROM mercado_ofertas JOIN objeto ON mercado_ofertas.objetoId = objeto.id`;

const oferta = (id) => db.prepare(`${SELECT_OFERTA} WHERE mercado_ofertas.id = ?`).get(id);

/** Devuelve el objeto de una oferta al inventario de su vendedor y la borra. */
function devolver(o, ahora = Date.now()) {
    db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(
        o.vendedor,
        o.objetoId,
        new Date(ahora).toISOString(),
    );
    db.prepare("DELETE FROM mercado_ofertas WHERE id = ?").run(o.id);
}

/** Devuelve a sus dueños las ofertas caducadas (de `vendedor`, o de todos). @returns {number} ofertas devueltas */
function devolverCaducadas(ahora = Date.now(), vendedor = null) {
    const caducadas = vendedor
        ? db.prepare("SELECT * FROM mercado_ofertas WHERE caduca <= ? AND vendedor = ?").all(ahora, String(vendedor))
        : db.prepare("SELECT * FROM mercado_ofertas WHERE caduca <= ?").all(ahora);
    for (const o of caducadas) db.transaction(() => devolver(o, ahora))();
    return caducadas.length;
}

/** Pone un objeto del inventario a la venta. @returns {{ ok: boolean, mensaje: string, oferta?: object }} */
function poner(userId, objetoId, precio, ahora = Date.now()) {
    if (!Number.isInteger(precio) || precio < 1 || precio > PRECIO_MAX) {
        return { ok: false, mensaje: `❌ El precio tiene que ser un número entero entre 1 y ${fmtNumero(PRECIO_MAX)}.` };
    }
    return db.transaction(() => {
        const unidad = unidadDe(userId, objetoId);
        if (!unidad) return { ok: false, mensaje: "❌ Ya no tienes ese objeto." };
        if (esDeProteccion(unidad))
            return { ok: false, mensaje: `❌ **${unidad.nombre}** es un objeto de protección: no se puede vender.` };
        const mias = db.prepare("SELECT COUNT(*) AS n FROM mercado_ofertas WHERE vendedor = ?").get(String(userId)).n;
        if (mias >= MAX_OFERTAS) return { ok: false, mensaje: `❌ Ya tienes ${MAX_OFERTAS} ofertas en el mercado. Retira alguna.` };
        db.prepare("DELETE FROM inventario WHERE id = ?").run(unidad.inventarioId);
        const info = db
            .prepare("INSERT INTO mercado_ofertas (vendedor, objetoId, precio, creada, caduca) VALUES (?, ?, ?, ?, ?)")
            .run(String(userId), objetoId, precio, ahora, ahora + CADUCIDAD_MS);
        return {
            ok: true,
            mensaje: `🏷️ **${unidad.nombre}** está a la venta por **${fmtNumero(precio)}** 🪙 (caduca en 7 días).`,
            oferta: oferta(info.lastInsertRowid),
        };
    })();
}

/** Retira una oferta propia: el objeto vuelve al inventario. */
function retirar(userId, ofertaId, ahora = Date.now()) {
    return db.transaction(() => {
        const o = oferta(ofertaId);
        if (!o || o.vendedor !== String(userId)) return { ok: false, mensaje: "❌ Esa oferta ya no existe." };
        devolver(o, ahora);
        return { ok: true, mensaje: `↩️ **${o.nombre}** vuelve a tu inventario.` };
    })();
}

/** Ofertas en vigor, las más recientes primero (`pagina` desde 1). Devuelve antes las caducadas a sus dueños. */
function listar({ pagina = 1, porPagina = 4, vendedor = null } = {}, ahora = Date.now()) {
    devolverCaducadas(ahora);
    const filtro = vendedor ? " WHERE mercado_ofertas.vendedor = ?" : "";
    const params = vendedor ? [String(vendedor)] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mercado_ofertas${vendedor ? " WHERE vendedor = ?" : ""}`).get(...params).n;
    const filas = db
        .prepare(`${SELECT_OFERTA}${filtro} ORDER BY mercado_ofertas.creada DESC, mercado_ofertas.id DESC LIMIT ? OFFSET ?`)
        .all(...params, porPagina, (Math.max(1, pagina) - 1) * porPagina);
    return { total, filas, paginas: Math.max(1, Math.ceil(total / porPagina)) };
}

/**
 * Compra una oferta: el efectivo del comprador pasa al vendedor y el objeto al comprador, todo en una transacción. Dos
 * compras a la vez no pueden cobrar la misma oferta.
 */
function comprar(compradorId, ofertaId, nombres = {}, ahora = Date.now()) {
    return db.transaction(() => {
        const o = oferta(ofertaId);
        if (!o) return { ok: false, mensaje: "❌ Esa oferta ya no está disponible." };
        if (o.caduca <= ahora) {
            devolver(o, ahora);
            return { ok: false, mensaje: "❌ Esa oferta ha caducado." };
        }
        if (o.vendedor === String(compradorId)) return { ok: false, mensaje: "❌ No puedes comprar tu propia oferta." };
        if (!puedeRecibir(compradorId, { id: o.objetoId, unico: o.unico })) {
            return { ok: false, mensaje: `❌ Ya tienes **${o.nombre}** y es un objeto único.` };
        }
        if (!dinero.cobrar(compradorId, o.precio)) {
            return { ok: false, mensaje: "❌ No te llega el efectivo para comprar esto. Saca dinero del banco (💵 Sacar)." };
        }
        db.prepare("DELETE FROM mercado_ofertas WHERE id = ?").run(o.id);
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(
            String(compradorId),
            o.objetoId,
            new Date(ahora).toISOString(),
        );
        dinero.apuntar(compradorId, "venta", `Mercado: compra de ${o.nombre} a ${nombres.vendedor || o.vendedor}`, -o.precio);
        dinero.pagarSinImpuesto(o.vendedor, "venta", `Mercado: venta de ${o.nombre} a ${nombres.comprador || compradorId}`, o.precio);
        return { ok: true, mensaje: `🏷️ Has comprado **${o.nombre}** por **${fmtNumero(o.precio)}** 🪙.`, oferta: o };
    })();
}

module.exports = { CADUCIDAD_MS, MAX_OFERTAS, PRECIO_MAX, oferta, poner, retirar, listar, comprar, devolverCaducadas };
