// Tope de impacto en el precio de TTCL por operación (#454). Sin nada de Discord: lo usan ejecutarCompra y ejecutarVenta
// de mercado.js y la vista previa de /cripto.
const guildSettings = require("../guildSettings");

/**
 * Cuánto movería una operación el precio del mercado, en % del precio de antes (#454). Se mide sobre el precio del mercado
 * antes y después de la operación, no sobre el precio medio que recibe quien opera, porque lo que hay que acotar es lo
 * que ven los demás. Con cripto.max_impacto_pct sin configurar (0) no hay tope.
 * @param {{ precioAntes: number, precioDespues: number }} cot - Una cotización (cotizarCompra o cotizarVenta)
 * @returns {{ impacto: number, tope: number, excede: boolean }}
 */
function impactoDe(guildId, cot) {
    const tope = Math.max(0, Number(guildSettings.getSettings(guildId).cripto.max_impacto_pct || 0));
    const impacto = (Math.abs(cot.precioDespues - cot.precioAntes) / cot.precioAntes) * 100;
    return { impacto, tope, excede: tope > 0 && impacto > tope + 1e-9 };
}

/** Lo que se contesta a quien intenta una operación que movería el precio por encima del tope. */
function mensajeImpacto({ impacto, tope }, tipo) {
    const pct = (n) => n.toFixed(2).replace(".", ",");
    return (
        `📊 ${tipo === "compra" ? "Esta compra" : "Esta venta"} movería el precio un ${pct(impacto)} % y el máximo por operación es ${pct(tope)} %. ` +
        `Baja ${tipo === "compra" ? "el importe" : "el porcentaje"} e inténtalo de nuevo.`
    );
}

module.exports = { impactoDe, mensajeImpacto };
