// Datos y compras de /tienda, separados del comando para poder probarlos sin Discord.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const dinero = require("./dinero");
const impuestos = require("./impuestos");
const { createLogger } = require("../core/logger");

const log = createLogger("Tienda");

const SELECT_ITEM =
    "SELECT tienda.id as tiendaId, objeto.*, tienda.precio, tienda.stock, tienda.precio_base, tienda.descuento, tienda.oferta_inicio, tienda.oferta_fin FROM tienda JOIN objeto ON tienda.objetoId = objeto.id";

/**
 * Un objeto de la tienda con su precio real. `precio` es lo que se muestra y se cobra: el precio actual (que sube con las
 * compras, #412) con la oferta temporal activa aplicada (#413). `precioLista` es el actual sin oferta y `precioBase` el que
 * puso el admin; `enOferta` dice si la oferta está en marcha. Los tres salen de aquí, así el catálogo, la confirmación, el
 * impuesto de compra y el cobro siempre ven el mismo precio.
 */
function conPrecio(fila, ahora = Date.now()) {
    if (!fila) return fila;
    const precioLista = fila.precio;
    const enOferta =
        fila.descuento > 0 && (!fila.oferta_inicio || ahora >= fila.oferta_inicio) && (!fila.oferta_fin || ahora < fila.oferta_fin);
    const precio = enOferta ? Math.max(0, Math.round((precioLista * (100 - fila.descuento)) / 100)) : precioLista;
    return { ...fila, precio, precioLista, precioBase: fila.precio_base ?? precioLista, enOferta };
}

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
    return db
        .prepare(`${SELECT_ITEM}${filtro} ORDER BY tienda.id ASC`)
        .all(...params)
        .map((fila) => conPrecio(fila));
}

/** Categorías y rarezas que hay en el catálogo, para los menús de filtro de /tienda. */
function valoresFiltro() {
    const distintos = (col) =>
        db
            .prepare(`SELECT DISTINCT ${col} AS v FROM objeto WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`)
            .all()
            .map((r) => r.v);
    return { categorias: distintos("categoria"), rarezas: distintos("rareza") };
}

function itemTienda(tiendaId) {
    return conPrecio(db.prepare(`${SELECT_ITEM} WHERE tienda.id = ?`).get(tiendaId));
}

/** Compras de la tienda de alguien (solo las de la tienda, no el resto del historial), más recientes primero. */
function historialCompras(userId) {
    return db
        .prepare(
            "SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? AND cantidad < 0 AND descripcion LIKE 'Compra en tienda:%' ORDER BY fecha DESC",
        )
        .all(userId);
}

// Con lo que se compra (systems/dinero): efectivo + dinero negro (F-EC-06b, se gasta igual).
function saldoDe(userId) {
    return dinero.saldoGastable(userId);
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
            if (!dinero.cobrarCombinado(userId, total)) return false;
            if (item.stock !== null) {
                const st = db.prepare("UPDATE tienda SET stock = stock - 1 WHERE id = ? AND stock > 0").run(item.tiendaId);
                if (st.changes !== 1) throw new Error("Sin stock");
            }
            db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, item.id, new Date().toISOString());
            dinero.apuntar(userId, "tienda", `Compra en tienda: ${item.nombre}`, -item.precio);
            subirPrecio(guildId, item);
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

/**
 * Precio dinámico (#412): cada compra sube el precio actual un `tienda.subida_pct` %, con un tope de `tienda.tope_pct` % por
 * encima del precio base (el que puso el admin). Con subida 0 está apagado, y los objetos únicos quedan fuera.
 */
function subirPrecio(guildId, item) {
    const cfg = guildSettings.getSettings(guildId).tienda;
    const subida = Number(cfg.subida_pct || 0);
    if (!(subida > 0) || item.unico) return;
    const fila = db.prepare("SELECT precio, precio_base FROM tienda WHERE id = ?").get(item.tiendaId);
    if (!fila) return;
    const base = fila.precio_base ?? fila.precio;
    const tope = Math.floor((base * (100 + Number(cfg.tope_pct ?? 100))) / 100);
    const nuevo = Math.min(tope, Math.max(fila.precio + 1, Math.ceil((fila.precio * (100 + subida)) / 100)));
    if (nuevo === fila.precio) return;
    db.prepare("UPDATE tienda SET precio = ?, precio_base = ? WHERE id = ?").run(nuevo, base, item.tiendaId);
}

/**
 * Cron (cada hora): el precio de los objetos que han subido baja hacia su base un `tienda.recuperacion_pct` % del precio
 * base, sin pasarse de él. Usa los ajustes del primer servidor que tenga el precio dinámico encendido (la tienda es una sola).
 * @returns {number} objetos cuyo precio ha cambiado
 */
function recuperarPrecios(guildIds) {
    const cfg = guildIds.map((g) => guildSettings.getSettings(g).tienda).find((t) => Number(t.subida_pct) > 0);
    if (!cfg) return 0;
    const pct = Number(cfg.recuperacion_pct || 0);
    if (!(pct > 0)) return 0;
    let cambiados = 0;
    for (const t of db.prepare("SELECT id, precio, precio_base FROM tienda WHERE precio_base IS NOT NULL AND precio > precio_base").all()) {
        const nuevo = Math.max(t.precio_base, t.precio - Math.max(1, Math.ceil((t.precio_base * pct) / 100)));
        db.prepare("UPDATE tienda SET precio = ?, precio_base = ? WHERE id = ?").run(
            nuevo,
            nuevo === t.precio_base ? null : t.precio_base,
            t.id,
        );
        cambiados++;
    }
    return cambiados;
}

module.exports = {
    conPrecio,
    recuperarPrecios,
    subirPrecio,
    itemsTienda,
    itemTienda,
    valoresFiltro,
    historialCompras,
    saldoDe,
    comprobarCompra,
    cobrarCompra,
};
