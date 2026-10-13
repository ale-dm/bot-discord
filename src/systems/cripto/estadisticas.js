// Cifras del mercado de TTCL para la pestaña 📈 Mercado: el resumen de un periodo (#447) y el ranking de ganancias (#445).
// Sin nada de Discord. Los precios y las ganancias salen de las mismas fuentes que la gráfica y la 💼 Cartera.
const db = require("../../core/db");
const mercado = require("./mercado");
const { gananciaRealizadaDeFilas } = require("./ganancias");

const DIA_MS = 24 * 3600 * 1000;

/**
 * Resumen de los últimos `dias` (365 o más = todo el historial): precio al inicio y al final, máximo, mínimo, variación en %
 * y volumen de compras y ventas. Los puntos de precio son los de la gráfica (los guardados en el periodo más el precio de
 * ahora); si hay un precio anterior al periodo, es el de inicio. Con menos de dos puntos no hay resumen de precios
 * (`suficientes: false`), pero el volumen se da igual. El volumen suma `cripto_historial`: en compras, lo pagado con
 * comisión; en ventas, lo recibido sin ella; y los TTCL movidos.
 * @returns {{ suficientes: boolean, inicio?: number, fin?: number, max?: number, min?: number, variacionPct?: number,
 *   compras: { monedas: number, ttcl: number, operaciones: number }, ventas: { monedas: number, ttcl: number, operaciones: number } }}
 */
function resumenPeriodo(dias, ahora = Date.now()) {
    const desde = dias >= 365 ? 0 : ahora - dias * DIA_MS;
    const puntos = db
        .prepare("SELECT precio FROM cripto_ttcl_precios WHERE timestamp >= ? ORDER BY timestamp ASC")
        .all(desde)
        .map((f) => f.precio);
    if (desde > 0) {
        const previo = db.prepare("SELECT precio FROM cripto_ttcl_precios WHERE timestamp < ? ORDER BY timestamp DESC LIMIT 1").get(desde);
        if (previo) puntos.unshift(previo.precio);
    }
    puntos.push(mercado.getTtclPrecio());

    const volumen = { compras: { monedas: 0, ttcl: 0, operaciones: 0 }, ventas: { monedas: 0, ttcl: 0, operaciones: 0 } };
    const filas = db
        .prepare(
            "SELECT tipo, SUM(monedas) AS monedas, SUM(cantidad) AS ttcl, COUNT(*) AS n FROM cripto_historial WHERE cripto = 'TTCL' AND timestamp >= ? GROUP BY tipo",
        )
        .all(desde);
    for (const f of filas) {
        volumen[f.tipo === "compra" ? "compras" : "ventas"] = { monedas: f.monedas, ttcl: f.ttcl, operaciones: f.n };
    }

    if (puntos.length < 2) return { suficientes: false, ...volumen };
    const inicio = puntos[0];
    const fin = puntos[puntos.length - 1];
    return {
        suficientes: true,
        inicio,
        fin,
        max: Math.max(...puntos),
        min: Math.min(...puntos),
        variacionPct: ((fin - inicio) / inicio) * 100,
        ...volumen,
    };
}

/**
 * Lo que alguien ganaría (o perdería) vendiendo ahora todo su TTCL: valor de lo que tiene menos lo que le costó al coste
 * medio de sus compras. Es la cuenta de la 💼 Cartera, y el ranking usa esta misma función para que las cifras coincidan.
 */
function gananciaSinVender(userId, precio = mercado.getTtclPrecio()) {
    const tenencia = mercado.getUserCarteras(userId).find((r) => r.cripto === mercado.TTCL.simbolo)?.cantidad || 0;
    const costeMedio = mercado.costeMedioTtcl(userId);
    const valor = tenencia * precio;
    return { tenencia, costeMedio, valor, ganancia: valor - tenencia * costeMedio };
}

/**
 * Quién más ha ganado con TTCL: la ganancia realizada más la que tiene sin vender, a precio de mercado de ahora. Solo
 * entra quien ha operado con TTCL; las pérdidas salen en negativo (si hay menos de `limite` personas, aparecen todas).
 * @returns {{ userId: string, total: number, realizada: number, sinVender: number }[]} de más a menos ganancia
 */
function rankingGanancias(limite = 5) {
    const filas = db
        .prepare(
            "SELECT userId, tipo, cantidad, monedas FROM cripto_historial WHERE cripto = 'TTCL' ORDER BY userId, timestamp ASC, id ASC",
        )
        .all();
    const porPersona = new Map();
    for (const f of filas) porPersona.set(f.userId, [...(porPersona.get(f.userId) || []), f]);

    const precio = mercado.getTtclPrecio();
    const ranking = [];
    for (const [userId, historial] of porPersona) {
        const realizada = gananciaRealizadaDeFilas(historial);
        const sinVender = Math.round(gananciaSinVender(userId, precio).ganancia);
        ranking.push({ userId, total: realizada + sinVender, realizada, sinVender });
    }
    return ranking.sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId)).slice(0, limite);
}

module.exports = { resumenPeriodo, gananciaSinVender, rankingGanancias };
