// Mercado de criptomonedas: TTCL con su pool de liquidez, historial de precios y compra/venta. Sin nada de Discord:
// lo usan /cripto, /perfil, las herramientas del Duende y el ticker de index.js.
const db = require("../../core/db");
const { logError, logInfo } = require("../../core/logger");
const guildSettings = require("../guildSettings");
const achievements = require("../achievementsSystem");
const dinero = require("../dinero");
const pase = require("../pase/pase");
const { CacheLimitada } = require("../../core/cacheLimitada");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

const TTCL = {
    id: "TTCL",
    nombre: "TTCL Coin",
    simbolo: "TTCL",
    emoji: "🟣",
    color: "#9b59b6",
    precioInicial: 100,
};

const ALL_CRYPTOS = [TTCL];

// ─── PRECIO TTCL (pool de liquidez) ──────────────────────────────────────────
// Las reservas están en cripto_pool: monedas y TTCL. El precio es monedas / TTCL, y cada operación se cobra
// contra el pool manteniendo monedas × TTCL constante (x·y = k): compras grandes mueven el precio más que las
// pequeñas, y comprar y vender de vuelta no sale gratis (la comisión queda en el pool).

function leerPool() {
    return db.prepare("SELECT monedas, ttcl FROM cripto_pool WHERE id = 1").get();
}

function getTtclPrecio() {
    const { monedas, ttcl } = leerPool();
    return monedas / ttcl;
}

/** TTCL que recibe quien invierte `monedas` (sin contar la comisión). */
function ttclPorMonedas(pool, monedas) {
    return pool.ttcl - (pool.monedas * pool.ttcl) / (pool.monedas + monedas);
}

/** Monedas brutas que recibe quien vende `ttcl` (antes de la comisión). */
function monedasPorTtcl(pool, ttcl) {
    return pool.monedas - (pool.monedas * pool.ttcl) / (pool.ttcl + ttcl);
}

/** TTCL que tiene la gente (la circulación real: lo que no está en el pool). */
function ttclCirculacion() {
    return db.prepare("SELECT COALESCE(SUM(cantidad), 0) AS n FROM cripto_carteras WHERE cripto = 'TTCL'").get().n;
}

// ─── HISTORIAL DE PRECIOS ─────────────────────────────────────────────────────

const historyCache = new CacheLimitada({ max: 50 });
const HISTORY_CACHE_TTL = 5 * 60_000;

async function fetchCryptoHistory(cryptoId, days) {
    const cacheKey = `${cryptoId}_${days}`;
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL) return cached.data;

    const since = days >= 365 ? 0 : Date.now() - days * 24 * 3600 * 1000;
    const rows = db.prepare("SELECT precio, timestamp FROM cripto_ttcl_precios WHERE timestamp >= ? ORDER BY timestamp ASC").all(since);
    const data = rows.map((r) => ({ t: r.timestamp, p: r.precio }));
    // Añadir punto actual
    data.push({ t: Date.now(), p: getTtclPrecio() });
    // Si no hay historial suficiente, añadir punto inicial del módulo para poder dibujar algo
    if (data.length < 2) {
        data.unshift({ t: data[0]?.t - 1000 || Date.now() - 1000, p: TTCL.precioInicial });
    }

    historyCache.set(cacheKey, { data, ts: Date.now() });
    return data;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatCoins(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
    return n.toFixed(2);
}

function formatCryptoAmt(n) {
    if (n < 0.0001) return n.toExponential(4);
    if (n < 0.01) return n.toFixed(6);
    if (n < 1) return n.toFixed(5);
    return n.toFixed(4);
}

// El 💵 efectivo: con lo que se compra cripto y adonde van las ventas (systems/dinero).
function getUserSaldo(userId) {
    return dinero.efectivo(userId);
}

function getUserCarteras(userId) {
    return db.prepare("SELECT cripto, cantidad FROM cripto_carteras WHERE userId = ? AND cantidad > 0").all(userId);
}

function cryptoInfoBySymbol(sym) {
    return ALL_CRYPTOS.find((c) => c.simbolo === sym) || null;
}

/**
 * Valor en monedas de la cartera de alguien, con el precio del pool.
 * @returns {Promise<{ lineas: {cripto, cantidad, info, precio, valor}[], total: number }>}
 */
async function valorarCartera(userId) {
    const ttclP = getTtclPrecio();
    const lineas = getUserCarteras(userId).map((row) => {
        const info = cryptoInfoBySymbol(row.cripto);
        const precio = row.cripto === "TTCL" ? ttclP : 0;
        return { cripto: row.cripto, cantidad: row.cantidad, info, precio, valor: row.cantidad * precio };
    });
    return { lineas, total: lineas.reduce((acc, l) => acc + l.valor, 0) };
}

// ─── TTCL CONTRA EL POOL ─────────────────────────────────────────────────────

function comprarTtcl(guildId, userId, monedasInvertidas) {
    const feePct = Math.max(0, Number(guildSettings.getSettings(guildId).cripto.fee_buy_pct || 0));
    const fee = Math.floor((monedasInvertidas * feePct) / 100);
    const costeTotal = monedasInvertidas + fee;
    try {
        const resultado = db.transaction(() => {
            const pool = leerPool();
            const ttcl = ttclPorMonedas(pool, monedasInvertidas);
            if (!(ttcl > 0)) return { ok: false, msg: "El pool no tiene TTCL para esa compra." };
            if (!dinero.cobrar(userId, costeTotal)) return { ok: false, costeTotal, insuficiente: true };

            // La comisión se queda en el pool: sube la reserva de monedas.
            db.prepare("UPDATE cripto_pool SET monedas = monedas + ?, ttcl = ttcl - ? WHERE id = 1").run(costeTotal, ttcl);
            db.prepare(
                `INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', ?)
                 ON CONFLICT(userId, cripto) DO UPDATE SET cantidad = cantidad + excluded.cantidad`,
            ).run(userId, ttcl);
            dinero.apuntar(userId, "cripto", `Compra ${formatCryptoAmt(ttcl)} TTCL${fee > 0 ? ` (comisión ${fee})` : ""}`, -costeTotal);
            db.prepare(
                "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES (?,?,?,?,?,?,?)",
            ).run(userId, "compra", "TTCL", ttcl, monedasInvertidas / ttcl, costeTotal, Date.now());
            db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(getTtclPrecio(), Date.now());
            return { ok: true, cantidad: ttcl, precio: monedasInvertidas / ttcl, monedas: monedasInvertidas, fee, costeTotal };
        })();
        if (!resultado.ok) {
            if (resultado.insuficiente)
                return {
                    ok: false,
                    msg: `No te llega el efectivo: necesitas ${costeTotal.toLocaleString("es")} 🪙. Saca dinero del banco.`,
                };
            return resultado;
        }
        logInfo(
            `[Cripto] Compra TTCL: ${userId} compró ${resultado.cantidad.toFixed(6)} TTCL por ${costeTotal} monedas (comisión ${fee}) · nuevo precio ${getTtclPrecio().toFixed(2)}`,
        );
        return resultado;
    } catch (e) {
        logError(`[Cripto] Error en compra de TTCL por ${userId}:`, e);
        return { ok: false, msg: "Error interno al procesar la compra." };
    }
}

function venderTtcl(userId, ttclAVender, pct, minSell, maxSell, feeSellPct) {
    try {
        const resultado = db.transaction(() => {
            const pool = leerPool();
            const brutas = Math.floor(monedasPorTtcl(pool, ttclAVender));
            if (brutas < minSell || brutas > maxSell) {
                return {
                    ok: false,
                    msg: `La venta debe estar entre ${minSell.toLocaleString("es")} y ${maxSell.toLocaleString("es")} 🪙.`,
                };
            }
            // La cantidad se comprueba dentro de la misma transacción: dos ventas a la vez no pueden vender lo mismo.
            const r = db
                .prepare(
                    "UPDATE cripto_carteras SET cantidad = MAX(0, cantidad - ?) WHERE userId = ? AND cripto = 'TTCL' AND cantidad >= ? - 1e-9",
                )
                .run(ttclAVender, userId, ttclAVender);
            if (r.changes === 0) return { ok: false, msg: "Ya no tienes esa cantidad en cartera (¿otra venta a la vez?)." };

            const fee = Math.floor((brutas * feeSellPct) / 100);
            const neto = brutas - fee;
            // La comisión se queda en el pool: el pool entrega el neto y recibe el TTCL.
            db.prepare("UPDATE cripto_pool SET monedas = monedas - ?, ttcl = ttcl + ? WHERE id = 1").run(neto, ttclAVender);
            dinero.pagarSinImpuesto(
                userId,
                "cripto",
                `Venta ${formatCryptoAmt(ttclAVender)} TTCL${fee > 0 ? ` (comisión ${fee})` : ""}`,
                neto,
            );
            db.prepare(
                "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES (?,?,?,?,?,?,?)",
            ).run(userId, "venta", "TTCL", ttclAVender, brutas / ttclAVender, neto, Date.now());
            db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(getTtclPrecio(), Date.now());
            return { ok: true, cantidad: ttclAVender, precio: brutas / ttclAVender, monedas: neto, fee };
        })();
        if (!resultado.ok) return resultado;
        logInfo(
            `[Cripto] Venta TTCL: ${userId} vendió ${ttclAVender.toFixed(6)} TTCL (${pct}%) por ${resultado.monedas} monedas (comisión ${resultado.fee}) · nuevo precio ${getTtclPrecio().toFixed(2)}`,
        );
        return resultado;
    } catch (e) {
        logError(`[Cripto] Error en venta de TTCL por ${userId}:`, e);
        return { ok: false, msg: "Error interno al procesar la venta." };
    }
}

// ─── LÓGICA DE TRANSACCIONES ──────────────────────────────────────────────────

async function ejecutarCompra(guildId, userId, sym, monedasInvertidas) {
    if (sym !== "TTCL") return { ok: false, msg: "Esa cripto ya no se opera." };
    const cfg = guildSettings.getSettings(guildId).cripto;
    const minBuy = Math.max(1, Number(cfg.min_buy || 0));
    const maxBuy = Math.max(minBuy, Number(cfg.max_buy || minBuy));
    if (monedasInvertidas < minBuy || monedasInvertidas > maxBuy) {
        return { ok: false, msg: `La compra debe estar entre ${minBuy.toLocaleString("es")} y ${maxBuy.toLocaleString("es")} 🪙.` };
    }

    const limiter = guildSettings.checkAndConsumeLimit(guildId, "cripto_buy", userId, {
        cooldownSec: Number(cfg.cooldown_buy_sec || 0),
    });
    if (!limiter.ok) {
        return { ok: false, msg: `⏳ Espera ${limiter.retrySeconds || 1}s antes de volver a comprar.` };
    }

    const r = comprarTtcl(guildId, userId, monedasInvertidas);
    if (r.ok) {
        pase.registrarSeguro(guildId, userId, "cripto");
        void achievements.applyEvent(guildId, userId, "cripto_buy_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_ops_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_buy_volume", monedasInvertidas);
        void achievements.applyEvent(guildId, userId, "cripto_volume", monedasInvertidas);
        const ttcl = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(userId)?.cantidad || 0;
        void achievements.applyEvent(guildId, userId, "ttcl_hold_max", ttcl);
    }
    return r;
}

async function ejecutarVenta(guildId, userId, sym, pct) {
    if (sym !== "TTCL") return { ok: false, msg: "Esa cripto ya no se opera." };
    const cfg = guildSettings.getSettings(guildId).cripto;
    const row = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(userId);
    if (!row || row.cantidad <= 0) return { ok: false, msg: "No tienes esa cripto en cartera." };

    const limiter = guildSettings.checkAndConsumeLimit(guildId, "cripto_sell", userId, {
        cooldownSec: Number(cfg.cooldown_sell_sec || 0),
    });
    if (!limiter.ok) {
        return { ok: false, msg: `⏳ Espera ${limiter.retrySeconds || 1}s antes de volver a vender.` };
    }

    pct = Math.min(100, Math.max(1, Number(pct) || 0));
    const cantAVender = row.cantidad * (pct / 100);
    const minSell = Math.max(1, Number(cfg.min_sell || 0));
    const maxSell = Math.max(minSell, Number(cfg.max_sell || minSell));
    const feeSellPct = Math.max(0, Number(cfg.fee_sell_pct || 0));

    const r = venderTtcl(userId, cantAVender, pct, minSell, maxSell, feeSellPct);
    if (r.ok) {
        pase.registrarSeguro(guildId, userId, "cripto");
        void achievements.applyEvent(guildId, userId, "cripto_sell_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_ops_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_sell_volume", r.monedas);
        void achievements.applyEvent(guildId, userId, "cripto_volume", r.monedas);
        const ttcl = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(userId)?.cantidad || 0;
        void achievements.applyEvent(guildId, userId, "ttcl_hold_max", ttcl);
    }
    return r;
}

// ─── PREVISIÓN Y CONSULTAS DEL PANEL ─────────────────────────────────────────

/** Lo que daría comprar TTCL por `monedas` (la comisión va aparte, como en comprarTtcl). Sin tocar nada. */
function cotizarCompra(monedas, feePct) {
    const pool = leerPool();
    const precioAntes = pool.monedas / pool.ttcl;
    const ttcl = ttclPorMonedas(pool, monedas);
    const fee = Math.floor((monedas * Math.max(0, feePct)) / 100);
    const coste = monedas + fee;
    const precioDespues = (pool.monedas + coste) / (pool.ttcl - ttcl);
    return { ttcl, fee, coste, precioAntes, precioMedio: monedas / ttcl, precioDespues };
}

/** Lo que daría vender `ttcl` (la comisión sale de lo bruto, como en venderTtcl). Sin tocar nada. */
function cotizarVenta(ttcl, feePct) {
    const pool = leerPool();
    const precioAntes = pool.monedas / pool.ttcl;
    const brutas = Math.floor(monedasPorTtcl(pool, ttcl));
    const fee = Math.floor((brutas * Math.max(0, feePct)) / 100);
    const neto = brutas - fee;
    const precioDespues = (pool.monedas - neto) / (pool.ttcl + ttcl);
    return { ttcl, brutas, fee, neto, precioAntes, precioMedio: brutas / ttcl, precioDespues };
}

/** Movimientos de TTCL de alguien, más recientes primero, paginados. */
function historialTtcl(userId, limite, offset) {
    return db
        .prepare(
            "SELECT tipo, cantidad, precio, monedas, timestamp FROM cripto_historial WHERE userId = ? AND cripto = 'TTCL' ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
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

module.exports = {
    TTCL,
    ALL_CRYPTOS,

    leerPool,
    ttclCirculacion,
    getTtclPrecio,
    cotizarCompra,
    cotizarVenta,
    historialTtcl,
    totalHistorialTtcl,
    costeMedioTtcl,
    topTenedoresTtcl,
    fetchCryptoHistory,
    formatCoins,
    formatCryptoAmt,
    getUserSaldo,
    getUserCarteras,

    valorarCartera,
    ejecutarCompra,
    ejecutarVenta,
};
