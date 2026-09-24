// Cobro de las compras de /tienda, separado del comando para poder probarlo sin Discord.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Tienda");

/**
 * Cobra una compra de la tienda: saldo, stock, inventario e historial, todo o nada (si algo
 * falla a mitad no se cobra sin entregar el objeto ni se gasta stock sin cobrar).
 * @param {{ id: number, tiendaId: number, nombre: string, precio: number, stock: number|null }} item
 * @returns {boolean} true si se completó
 */
function cobrarCompra(userId, item, etiqueta = userId) {
    try {
        return db.transaction(() => {
            const cobro = db
                .prepare("UPDATE banco SET saldo = saldo - ? WHERE userId = ? AND saldo >= ?")
                .run(item.precio, userId, item.precio);
            if (cobro.changes !== 1) return false;
            if (item.stock !== null) {
                const st = db.prepare("UPDATE tienda SET stock = stock - 1 WHERE id = ? AND stock > 0").run(item.tiendaId);
                if (st.changes !== 1) throw new Error("Sin stock");
            }
            db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, item.id, new Date().toISOString());
            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                userId,
                new Date().toISOString(),
                `Compra en tienda: ${item.nombre}`,
                -item.precio,
            );
            return true;
        })();
    } catch (e) {
        log.warn(`Compra revertida para ${etiqueta} (${item.nombre}): ${e.message}`);
        return false;
    }
}

module.exports = { cobrarCompra };
