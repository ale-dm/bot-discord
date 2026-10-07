// Datos y compras de /tienda, separados del comando para poder probarlos sin Discord.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const dinero = require("./dinero");
const impuestos = require("./impuestos");
const { createLogger } = require("../core/logger");

const log = createLogger("Tienda");

const SELECT_ITEM =
    "SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock FROM tienda JOIN objeto ON tienda.objetoId = objeto.id";

/** Objetos a la venta, con filtros opcionales (los de /tienda ver). */
function itemsTienda({ busqueda, soloDisponibles, categoria, rareza } = {}) {
    const where = [];
    const params = [];
    if (busqueda) {
        where.push("(objeto.nombre LIKE ? OR objeto.tipo LIKE ?)");
        params.push(`%${busqueda}%`, `%${busqueda}%`);
    }
    if (soloDisponibles) where.push("(tienda.stock IS NULL OR tienda.stock > 0)");
    if (categoria) {
        where.push("objeto.categoria = ?");
        params.push(categoria);
    }
    if (rareza) {
        where.push("objeto.rareza = ?");
        params.push(rareza);
    }
    const filtro = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    return db.prepare(`${SELECT_ITEM}${filtro} ORDER BY tienda.id ASC`).all(...params);
}

function itemTienda(tiendaId) {
    return db.prepare(`${SELECT_ITEM} WHERE tienda.id = ?`).get(tiendaId);
}

/** Compras de la tienda de alguien (solo las de la tienda, no el resto del historial), más recientes primero. */
function historialCompras(userId) {
    return db
        .prepare(
            "SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? AND cantidad < 0 AND descripcion LIKE 'Compra en tienda:%' ORDER BY fecha DESC",
        )
        .all(userId);
}

// El 💵 efectivo, con lo que se compra (systems/dinero).
function saldoDe(userId) {
    return dinero.efectivo(userId);
}

/**
 * Comprueba si alguien puede comprar un objeto: único y ya lo tiene, agotado, sin saldo, cooldown o
 * límite diario. El cupo de compras se consume solo si todo lo demás está bien (una compra rechazada
 * no cuenta). @returns {{ ok: true } | { ok: false, mensaje: string }}
 */
function comprobarCompra(guildId, userId, item, tiendaCfg) {
    if (item.unico && db.prepare("SELECT 1 FROM inventario WHERE userId = ? AND itemId = ?").get(userId, item.id)) {
        return { ok: false, mensaje: "❌ Solo puedes comprar este objeto una vez." };
    }
    if (item.stock !== null && item.stock <= 0) return { ok: false, mensaje: "❌ Este objeto está agotado." };
    const impuestoCompra = impuestos.impuestoDeCompra(guildId, item.precio)?.impuesto || 0;
    if (saldoDe(userId) < item.precio + impuestoCompra) {
        return { ok: false, mensaje: "❌ No te llega el efectivo para comprar este objeto. Saca dinero del banco (💵 Sacar)." };
    }
    const limiter = guildSettings.checkAndConsumeLimit(guildId, "tienda_buy", userId, {
        cooldownSec: Number(tiendaCfg.buy_cooldown_sec || 0),
        dailyLimit: Number(tiendaCfg.daily_limit || 0),
    });
    if (!limiter.ok) {
        return {
            ok: false,
            mensaje:
                limiter.reason === "cooldown"
                    ? `⏳ Espera ${limiter.retrySeconds || 1}s antes de otra compra.`
                    : "📛 Alcanzaste el límite diario de compras en tienda.",
        };
    }
    return { ok: true };
}

/**
 * Cobra una compra de la tienda: saldo, stock, inventario e historial, todo o nada (si algo
 * falla a mitad no se cobra sin entregar el objeto ni se gasta stock sin cobrar). Si hay una
 * regla de impuesto de compra activa (F-EC-06a), el comprador paga precio + impuesto.
 * @param {{ id: number, tiendaId: number, nombre: string, precio: number, stock: number|null }} item
 * @returns {boolean} true si se completó
 */
function cobrarCompra(userId, guildId, item, etiqueta = userId) {
    try {
        return db.transaction(() => {
            const impuestoCompra = impuestos.impuestoDeCompra(guildId, item.precio);
            const total = item.precio + (impuestoCompra?.impuesto || 0);
            if (!dinero.cobrar(userId, total)) return false;
            if (item.stock !== null) {
                const st = db.prepare("UPDATE tienda SET stock = stock - 1 WHERE id = ? AND stock > 0").run(item.tiendaId);
                if (st.changes !== 1) throw new Error("Sin stock");
            }
            db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, item.id, new Date().toISOString());
            dinero.apuntar(userId, "tienda", `Compra en tienda: ${item.nombre}`, -item.precio);
            if (impuestoCompra) {
                dinero.apuntar(userId, "impuesto", `Impuesto de compra: ${item.nombre}`, -impuestoCompra.impuesto);
                if (impuestoCompra.destino === "bote") impuestos.sumarBote(guildId, impuestoCompra.impuesto);
            }
            return true;
        })();
    } catch (e) {
        log.warn(`Compra revertida para ${etiqueta} (${item.nombre}): ${e.message}`);
        return false;
    }
}

module.exports = { itemsTienda, itemTienda, historialCompras, saldoDe, comprobarCompra, cobrarCompra };
