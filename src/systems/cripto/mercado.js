// Mercado de criptomonedas: catálogo, precio de $TTCL (curva según la circulación), precios
// reales de CoinGecko, historial de precios y compra/venta. Sin nada de Discord: lo usan
// /cripto, /nivel, las herramientas del Duende y el ticker de index.js.
const db = require("../../core/db");
const { logError, logInfo, logWarn } = require("../../core/logger");
const guildSettings = require("../guildSettings");
const achievements = require("../achievementsSystem");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

const TTCL = {
    id: "TTCL",
    nombre: "TTCL Coin",
    simbolo: "TTCL",
    emoji: "🟣",
    color: "#9b59b6",
    precioInicial: 100,
    ofertaTotal: 1_000_000,
    factorVolatilidad: 40,
};

const REAL_CRYPTOS = [
    { id: "bitcoin", nombre: "Bitcoin", simbolo: "BTC", emoji: "🟡", color: "#f7931a" },
    { id: "ethereum", nombre: "Ethereum", simbolo: "ETH", emoji: "🔷", color: "#627eea" },
    { id: "solana", nombre: "Solana", simbolo: "SOL", emoji: "🟢", color: "#00ffa3" },
    { id: "binancecoin", nombre: "BNB", simbolo: "BNB", emoji: "🟠", color: "#f3ba2f" },
    { id: "ripple", nombre: "XRP", simbolo: "XRP", emoji: "🔵", color: "#346aa9" },
    { id: "dogecoin", nombre: "Dogecoin", simbolo: "DOGE", emoji: "🐕", color: "#c2a633" },
];

const ALL_CRYPTOS = [TTCL, ...REAL_CRYPTOS];

// 1 € = 1.000 monedas del servidor
const COINS_PER_EUR = 1000;

// Opciones para el selector de rango de gráfico
const RANGE_OPTIONS = [
    { label: "24 horas", value: "1", days: 1 },
    { label: "7 días", value: "7", days: 7 },
    { label: "30 días", value: "30", days: 30 },
    { label: "Todo", value: "365", days: 365 },
];

// ─── TABLAS DB (auto-creación) ────────────────────────────────────────────────

// ─── PRECIO TTCL (AMM) ───────────────────────────────────────────────────────

function ttclCirculacion() {
    return db.prepare("SELECT circulacion FROM cripto_ttcl WHERE id = 1").get()?.circulacion || 0;
}

function calcTtclPrecio(circulacion, guildId = null) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const basePrice = Math.max(0.0001, Number(cfg.ttcl_base_price || TTCL.precioInicial));
    const volatility = Math.max(0, Number(cfg.ttcl_volatility || TTCL.factorVolatilidad));
    const ratio = circulacion / TTCL.ofertaTotal;
    return basePrice * Math.exp((ratio * volatility) / 10);
}

function getTtclPrecio(guildId = null) {
    return calcTtclPrecio(ttclCirculacion(), guildId);
}

// ─── COINGECKO ────────────────────────────────────────────────────────────────

let geckoCache = { data: null, ts: 0 };
const GECKO_TTL = 60_000;

async function fetchGeckoPrices() {
    const now = Date.now();
    if (geckoCache.data && now - geckoCache.ts < GECKO_TTL) return geckoCache.data;
    try {
        const ids = REAL_CRYPTOS.map((c) => c.id).join(",");
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`;
        // Con timeout: sin él, una CoinGecko lenta dejaba colgada la compra/venta.
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        // Un 429 (rate limit) devuelve JSON de error: no se cachea como si fueran precios.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        geckoCache = { data, ts: now };
        return data;
    } catch (e) {
        logWarn("[Cripto] CoinGecko price fetch failed: " + e.message);
        return geckoCache.data || {};
    }
}

const historyCache = new Map();
const HISTORY_CACHE_TTL = 5 * 60_000;

async function fetchCryptoHistory(cryptoId, days, guildId = null) {
    const cacheKey = `${guildId || "global"}_${cryptoId}_${days}`;
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL) return cached.data;

    let data = [];

    if (cryptoId === "TTCL") {
        const since = days >= 365 ? 0 : Date.now() - days * 24 * 3600 * 1000;
        const rows = db.prepare("SELECT precio, timestamp FROM cripto_ttcl_precios WHERE timestamp >= ? ORDER BY timestamp ASC").all(since);
        data = rows.map((r) => ({ t: r.timestamp, p: r.precio }));
        // Añadir punto actual
        data.push({ t: Date.now(), p: getTtclPrecio(guildId) });
        // Si no hay historial suficiente, añadir punto inicial del módulo para poder dibujar algo
        if (data.length < 2) {
            data.unshift({ t: data[0]?.t - 1000 || Date.now() - 1000, p: TTCL.precioInicial });
        }
    } else {
        try {
            const daysParam = days >= 365 ? "365" : String(days);
            const url = `https://api.coingecko.com/api/v3/coins/${cryptoId}/market_chart?vs_currency=eur&days=${daysParam}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw = await res.json();
            data = (raw.prices || []).map(([t, p]) => ({ t, p: p * COINS_PER_EUR }));
        } catch (e) {
            logWarn("[Cripto] CoinGecko history fetch failed: " + e.message);
            // Un fallo (timeout, 429...) no se cachea 5 min: el siguiente intento vuelve a probar.
            return cached ? cached.data : [];
        }
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

function getUserSaldo(userId) {
    let row = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(userId);
    if (!row) {
        try {
            db.prepare("INSERT OR IGNORE INTO banco (userId, saldo) VALUES (?, 1000)").run(userId);
        } catch (e) {
            logWarn(`[Cripto] No se pudo crear la cuenta de banco de ${userId}: ${e.message}`);
        }
        row = db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(userId);
    }
    return row?.saldo ?? 1000;
}

function getUserCarteras(userId) {
    return db.prepare("SELECT cripto, cantidad FROM cripto_carteras WHERE userId = ? AND cantidad > 0").all(userId);
}

function cryptoInfoBySymbol(sym) {
    return ALL_CRYPTOS.find((c) => c.simbolo === sym) || null;
}

// ─── LÓGICA DE TRANSACCIONES ──────────────────────────────────────────────────

async function ejecutarCompra(guildId, userId, sym, monedasInvertidas) {
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

    let priceCoins;
    if (sym === "TTCL") {
        priceCoins = getTtclPrecio(guildId);
    } else {
        const ci = cryptoInfoBySymbol(sym);
        const prices = await fetchGeckoPrices();
        priceCoins = (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
    }
    if (!priceCoins) return { ok: false, msg: "No se pudo obtener el precio." };

    const feeBuyPct = Math.max(0, Number(cfg.fee_buy_pct || 0));
    const fee = Math.floor((monedasInvertidas * feeBuyPct) / 100);
    const costeTotal = monedasInvertidas + fee;
    const saldo = getUserSaldo(userId);
    if (saldo < costeTotal) return { ok: false, msg: `Saldo insuficiente. Necesitas ${costeTotal.toLocaleString("es")} 🪙.` };

    const cryptoAmt = monedasInvertidas / priceCoins;
    try {
        const comprada = db.transaction(() => {
            const r = db.prepare("UPDATE banco SET saldo = saldo - ? WHERE userId = ? AND saldo >= ?").run(costeTotal, userId, costeTotal);
            if (r.changes === 0) return false;
            db.prepare(
                `
                INSERT INTO cripto_carteras (userId, cripto, cantidad)
                VALUES (?, ?, ?)
                ON CONFLICT(userId, cripto) DO UPDATE SET cantidad = cantidad + excluded.cantidad
            `,
            ).run(userId, sym, cryptoAmt);

            if (sym === "TTCL") {
                db.prepare("UPDATE cripto_ttcl SET circulacion = circulacion + ? WHERE id = 1").run(cryptoAmt);
                const newP = calcTtclPrecio(ttclCirculacion(), guildId);
                db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(newP, Date.now());
            }

            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                userId,
                new Date().toISOString(),
                `Compra ${formatCryptoAmt(cryptoAmt)} ${sym}${fee > 0 ? ` (fee ${fee})` : ""}`,
                -costeTotal,
            );

            db.prepare(
                "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES (?,?,?,?,?,?,?)",
            ).run(userId, "compra", sym, cryptoAmt, priceCoins, costeTotal, Date.now());
            return true;
        })();
        if (!comprada) return { ok: false, msg: `Saldo insuficiente. Necesitas ${costeTotal.toLocaleString("es")} 🪙.` };
        void achievements.applyEvent(guildId, userId, "cripto_buy_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_ops_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_buy_volume", monedasInvertidas);
        void achievements.applyEvent(guildId, userId, "cripto_volume", monedasInvertidas);
        if (sym === "TTCL") {
            const ttcl = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(userId)?.cantidad || 0;
            void achievements.applyEvent(guildId, userId, "ttcl_hold_max", ttcl);
        }
        logInfo(
            `[Cripto] Compra: ${userId} compró ${cryptoAmt.toFixed(6)} ${sym} a ${priceCoins.toFixed(2)} por ${costeTotal} monedas (comisión ${fee})${sym === "TTCL" ? ` · nuevo precio TTCL ${getTtclPrecio(guildId).toFixed(2)}` : ""}`,
        );
        return { ok: true, cantidad: cryptoAmt, precio: priceCoins, monedas: monedasInvertidas, fee, costeTotal };
    } catch (e) {
        logError(`[Cripto] Error en compra de ${sym} por ${userId}:`, e);
        return { ok: false, msg: "Error interno al procesar la compra." };
    }
}

async function ejecutarVenta(guildId, userId, sym, pct) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const row = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = ?").get(userId, sym);
    if (!row || row.cantidad <= 0) return { ok: false, msg: "No tienes esa cripto en cartera." };

    const limiter = guildSettings.checkAndConsumeLimit(guildId, "cripto_sell", userId, {
        cooldownSec: Number(cfg.cooldown_sell_sec || 0),
    });
    if (!limiter.ok) {
        return { ok: false, msg: `⏳ Espera ${limiter.retrySeconds || 1}s antes de volver a vender.` };
    }

    pct = Math.min(100, Math.max(1, Number(pct) || 0));
    const cantAVender = row.cantidad * (pct / 100);
    let priceCoins;
    if (sym === "TTCL") {
        priceCoins = getTtclPrecio(guildId);
    } else {
        const ci = cryptoInfoBySymbol(sym);
        const prices = await fetchGeckoPrices();
        priceCoins = (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
    }
    if (!priceCoins) return { ok: false, msg: "No se pudo obtener el precio." };

    const monedasBrutas = Math.floor(cantAVender * priceCoins);
    const minSell = Math.max(1, Number(cfg.min_sell || 0));
    const maxSell = Math.max(minSell, Number(cfg.max_sell || minSell));
    if (monedasBrutas < minSell || monedasBrutas > maxSell) {
        return { ok: false, msg: `La venta debe estar entre ${minSell.toLocaleString("es")} y ${maxSell.toLocaleString("es")} 🪙.` };
    }
    const feeSellPct = Math.max(0, Number(cfg.fee_sell_pct || 0));
    const fee = Math.floor((monedasBrutas * feeSellPct) / 100);
    const monedasRecibidas = Math.max(0, monedasBrutas - fee);

    try {
        // La cantidad se leyó antes de esperar a CoinGecko: si en ese tiempo se ha vendido desde otro
        // botón (doble clic en "100 %"), se vendía dos veces lo mismo y la cartera quedaba en negativo.
        // Se descuenta solo si sigue habiendo suficiente (con margen por redondeo).
        const vendida = db.transaction(() => {
            const r = db
                .prepare(
                    "UPDATE cripto_carteras SET cantidad = MAX(0, cantidad - ?) WHERE userId = ? AND cripto = ? AND cantidad >= ? - 1e-9",
                )
                .run(cantAVender, userId, sym, cantAVender);
            if (r.changes === 0) return false;
            db.prepare("UPDATE banco SET saldo = saldo + ? WHERE userId = ?").run(monedasRecibidas, userId);

            if (sym === "TTCL") {
                db.prepare("UPDATE cripto_ttcl SET circulacion = MAX(0, circulacion - ?) WHERE id = 1").run(cantAVender);
                const newP = calcTtclPrecio(ttclCirculacion(), guildId);
                db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(newP, Date.now());
            }

            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                userId,
                new Date().toISOString(),
                `Venta ${formatCryptoAmt(cantAVender)} ${sym}${fee > 0 ? ` (fee ${fee})` : ""}`,
                monedasRecibidas,
            );

            db.prepare(
                "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES (?,?,?,?,?,?,?)",
            ).run(userId, "venta", sym, cantAVender, priceCoins, monedasRecibidas, Date.now());
            return true;
        })();
        if (!vendida) return { ok: false, msg: "Ya no tienes esa cantidad en cartera (¿otra venta a la vez?)." };
        void achievements.applyEvent(guildId, userId, "cripto_sell_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_ops_count", 1);
        void achievements.applyEvent(guildId, userId, "cripto_sell_volume", monedasRecibidas);
        void achievements.applyEvent(guildId, userId, "cripto_volume", monedasRecibidas);
        if (sym === "TTCL") {
            const ttcl = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(userId)?.cantidad || 0;
            void achievements.applyEvent(guildId, userId, "ttcl_hold_max", ttcl);
        }
        logInfo(
            `[Cripto] Venta: ${userId} vendió ${cantAVender.toFixed(6)} ${sym} (${pct}%) a ${priceCoins.toFixed(2)} por ${monedasRecibidas} monedas (comisión ${fee})${sym === "TTCL" ? ` · nuevo precio TTCL ${getTtclPrecio(guildId).toFixed(2)}` : ""}`,
        );
        return { ok: true, cantidad: cantAVender, precio: priceCoins, monedas: monedasRecibidas, fee };
    } catch (e) {
        logError(`[Cripto] Error en venta de ${sym} por ${userId}:`, e);
        return { ok: false, msg: "Error interno al procesar la venta." };
    }
}

module.exports = {
    TTCL,
    REAL_CRYPTOS,
    ALL_CRYPTOS,
    COINS_PER_EUR,
    RANGE_OPTIONS,
    ttclCirculacion,
    calcTtclPrecio,
    getTtclPrecio,
    fetchGeckoPrices,
    fetchCryptoHistory,
    formatCoins,
    formatCryptoAmt,
    getUserSaldo,
    getUserCarteras,
    cryptoInfoBySymbol,
    ejecutarCompra,
    ejecutarVenta,
};
