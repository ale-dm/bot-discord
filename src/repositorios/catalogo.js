// SQL del catálogo de objetos y de lo que está a la venta (panel admin → 🛒 Catálogo). Las reglas y los avisos están en
// adminPanel/catalogo; aquí solo las consultas, tal cual (#473).
const db = require("../core/db");

const listarObjetosConVenta = () =>
    db
        .prepare(
            `SELECT o.*, t.id AS tiendaId, t.precio, t.stock
             FROM objeto o LEFT JOIN tienda t ON t.objetoId = o.id ORDER BY o.id ASC`,
        )
        .all();

const crearObjeto = (nombre, descripcion, imagen, tipo, rolId, efecto) =>
    db
        .prepare("INSERT INTO objeto (nombre, descripcion, imagen, tipo, unico, rolId, efecto) VALUES (?, ?, ?, ?, 0, ?, ?)")
        .run(nombre, descripcion, imagen, tipo, rolId, efecto);

/** `columna` sale de una lista fija del panel (nunca de lo que escribe quien edita). */
const editarCampoObjeto = (columna, valor, id) => db.prepare(`UPDATE objeto SET ${columna} = ? WHERE id = ?`).run(valor, id);

const alguienTieneObjeto = (id) => Boolean(db.prepare("SELECT 1 FROM inventario WHERE itemId = ? LIMIT 1").get(id));
const objetoEstaEnVenta = (id) => Boolean(db.prepare("SELECT 1 FROM tienda WHERE objetoId = ? LIMIT 1").get(id));
const borrarObjeto = (id) => db.prepare("DELETE FROM objeto WHERE id = ?").run(id);

const ventaDeObjeto = (objetoId) => db.prepare("SELECT id, objetoId, precio, stock FROM tienda WHERE objetoId = ?").get(objetoId);
const cambiarVenta = (precio, stock, id) => db.prepare("UPDATE tienda SET precio = ?, stock = ? WHERE id = ?").run(precio, stock, id);
const ponerEnVenta = (objetoId, precio, stock) =>
    db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, ?)").run(objetoId, precio, stock);
const quitarDeVenta = (objetoId) => db.prepare("DELETE FROM tienda WHERE objetoId = ?").run(objetoId);

const objetoPorId = (id) =>
    db.prepare("SELECT id, nombre, descripcion, imagen, tipo, unico, categoria, rareza, rolId, efecto FROM objeto WHERE id = ?").get(id);

/** Un objeto por su nombre exacto (sin distinguir mayúsculas), o undefined. Para los objetos por nivel del pase (#364). */
const objetoPorNombre = (nombre) => db.prepare("SELECT id, nombre FROM objeto WHERE nombre = ? COLLATE NOCASE").get(nombre);

module.exports = {
    objetoPorNombre,
    listarObjetosConVenta,
    crearObjeto,
    editarCampoObjeto,
    alguienTieneObjeto,
    objetoEstaEnVenta,
    borrarObjeto,
    ventaDeObjeto,
    cambiarVenta,
    ponerEnVenta,
    quitarDeVenta,
    objetoPorId,
};
