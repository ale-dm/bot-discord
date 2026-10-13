// Ganancia ya cobrada con las ventas de TTCL (#443), a partir del historial de compras y ventas de cada persona.
const db = require("../../core/db");

/**
 * Ganancia (o pérdida) ya cobrada con las ventas de TTCL de alguien, en monedas. Se recorre el historial en orden con
 * coste medio móvil: cada venta gana lo recibido (neto, ya sin su comisión) menos lo que costaron esas unidades al coste
 * medio de ese momento, comisión de compra incluida. 0 si nunca ha vendido.
 */
function gananciaRealizadaTtcl(userId) {
    const filas = db
        .prepare("SELECT tipo, cantidad, monedas FROM cripto_historial WHERE userId = ? AND cripto = 'TTCL' ORDER BY timestamp ASC, id ASC")
        .all(String(userId));
    let unidades = 0;
    let coste = 0;
    let realizada = 0;
    for (const f of filas) {
        if (f.tipo === "compra") {
            unidades += f.cantidad;
            coste += f.monedas;
        } else if (unidades > 0) {
            const vendidas = Math.min(f.cantidad, unidades);
            const costeVendido = (coste / unidades) * vendidas;
            realizada += f.monedas - costeVendido;
            unidades -= vendidas;
            coste -= costeVendido;
        }
    }
    return Math.round(realizada);
}

module.exports = { gananciaRealizadaTtcl };
