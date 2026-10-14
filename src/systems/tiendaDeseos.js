// ⭐ Lista de deseos de la tienda (#404): cada persona sigue objetos del catálogo (hasta 25) y recibe un DM cuando uno agotado
// vuelve a tener stock o cuando baja su precio. El aviso sale de los cambios que hace un admin (stock, precio u oferta); no se
// repite hasta el siguiente cambio. Esta parte no manda nada: decide a quién y por qué (lo envía adminPanel/catalogoExtras).
const db = require("../core/db");
const tienda = require("./tienda");

const LIMITE = 25;

const cuantos = (userId) => db.prepare("SELECT COUNT(*) AS n FROM tienda_deseos WHERE userId = ?").get(String(userId)).n;
const sigue = (userId, tiendaId) =>
    Boolean(db.prepare("SELECT 1 FROM tienda_deseos WHERE userId = ? AND tiendaId = ?").get(String(userId), tiendaId));

/** Sigue o deja de seguir un objeto del catálogo. */
function alternar(userId, tiendaId) {
    if (sigue(userId, tiendaId)) {
        db.prepare("DELETE FROM tienda_deseos WHERE userId = ? AND tiendaId = ?").run(String(userId), tiendaId);
        return { ok: true, siguiendo: false, total: cuantos(userId) };
    }
    if (!tienda.itemTienda(tiendaId)) return { ok: false, mensaje: "❌ Ese objeto ya no está a la venta." };
    if (cuantos(userId) >= LIMITE) return { ok: false, mensaje: `❌ Ya sigues ${LIMITE} objetos, el máximo. Deja de seguir alguno.` };
    db.prepare("INSERT INTO tienda_deseos (userId, tiendaId) VALUES (?, ?)").run(String(userId), tiendaId);
    return { ok: true, siguiendo: true, total: cuantos(userId) };
}

/** Los objetos que sigue alguien (los que ya no están a la venta se quitan de la lista). */
function lista(userId) {
    const items = [];
    for (const { tiendaId } of db.prepare("SELECT tiendaId FROM tienda_deseos WHERE userId = ? ORDER BY tiendaId").all(String(userId))) {
        const item = tienda.itemTienda(tiendaId);
        if (item) items.push(item);
        else db.prepare("DELETE FROM tienda_deseos WHERE tiendaId = ?").run(tiendaId);
    }
    return items;
}

const agotado = (item) => item.stock !== null && item.stock <= 0;

/** Por qué avisar a quien sigue un objeto que ha pasado de `antes` a `despues`: "stock", "precio" o null. */
function motivoDeAviso(antes, despues) {
    if (!antes || !despues) return null;
    if (agotado(antes) && !agotado(despues)) return "stock";
    if (despues.precio < antes.precio) return "precio";
    return null;
}

const seguidores = (tiendaId) =>
    db
        .prepare("SELECT userId FROM tienda_deseos WHERE tiendaId = ?")
        .all(tiendaId)
        .map((r) => r.userId);

module.exports = { LIMITE, alternar, cuantos, sigue, lista, motivoDeAviso, seguidores };
