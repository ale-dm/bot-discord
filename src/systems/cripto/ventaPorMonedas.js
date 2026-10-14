// 💸 Vender TTCL por cantidad de monedas (#365): la inversa de la venta por porcentaje. La persona dice cuántas monedas quiere
// recibir NETAS (ya con la comisión) y aquí se calcula cuánto TTCL hay que vender. Siempre se redondea hacia abajo: nunca se
// recibe más de lo pedido (por unas pocas monedas menos, como mucho).
const mercado = require("./mercado");

/** Lo neto que da vender `brutas` monedas brutas con la comisión `feePct`. */
const netoDe = (brutas, feePct) => brutas - Math.floor((brutas * Math.max(0, feePct)) / 100);

/**
 * TTCL que hay que vender para recibir como mucho `netoDeseado` monedas netas, o null si el pool no da tanto.
 * Con x·y = k, vender t da M·t/(T+t) brutas, así que t = brutas·T/(M−brutas).
 */
function ttclParaRecibir(netoDeseado, feePct) {
    const { monedas: M, ttcl: T } = mercado.leerPool();
    if (!(netoDeseado > 0)) return null;
    // La mayor cantidad bruta entera cuyo neto no pasa de lo pedido (el neto sube con lo bruto: se busca por bisección).
    let bajo = 0;
    let alto = Math.min(Math.floor(M) - 1, Math.ceil(netoDeseado / Math.max(0.01, 1 - feePct / 100)) + 1);
    if (alto < 1) return null;
    while (bajo < alto) {
        const medio = Math.ceil((bajo + alto) / 2);
        if (netoDe(medio, feePct) <= netoDeseado) bajo = medio;
        else alto = medio - 1;
    }
    if (bajo < 1) return null;
    let ttcl = (bajo * T) / (M - bajo);
    // El redondeo de la venta real (floor de lo bruto) puede quedarse en una moneda menos: nunca pasarse.
    while (ttcl > 0 && mercado.cotizarVenta(ttcl, feePct).neto > netoDeseado) ttcl *= 0.999999;
    return ttcl;
}

/**
 * La vista previa de vender por monedas: { ok: true, ttcl, cot } o { ok: false, motivo } si lo pedido supera lo que vale la posición
 * (en ese caso no se vende nada, ni siquiera "todo").
 */
function cotizarPorMonedas(tenencia, netoDeseado, feePct) {
    const ttcl = ttclParaRecibir(netoDeseado, feePct);
    if (ttcl === null) return { ok: false, motivo: "El pool no da tanto por una sola venta." };
    if (ttcl > tenencia + 1e-9) {
        const todo = mercado.cotizarVenta(tenencia, feePct).neto;
        return { ok: false, motivo: `Tu posición solo da ${todo.toLocaleString("es")} monedas netas ahora mismo.` };
    }
    return { ok: true, ttcl, cot: mercado.cotizarVenta(ttcl, feePct) };
}

module.exports = { netoDe, ttclParaRecibir, cotizarPorMonedas };
