// Paneles de /cripto (solo mensajes; la lógica está en systems/cripto), una función por pestaña.
const comun = require("./comun");
const mercado = require("./mercado");
const operar = require("./operar");
const cartera = require("./cartera");
const historial = require("./historial");

/** La pantalla completa de una pestaña. */
async function pestana(nombre, userId, guildId) {
    switch (nombre) {
        case "mercado":
            return mercado.pantallaMercado(guildId);
        case "comprar":
            return operar.pantallaComprar(userId, guildId);
        case "vender":
            return operar.pantallaVender(userId, guildId);
        case "cartera":
            return cartera.pantallaCartera(userId);
        case "historial":
            return historial.pantallaHistorial(userId, 0);
        default:
            return mercado.pantallaMercado(guildId);
    }
}

/**
 * Vuelve a pintar la pantalla de la que venía el botón 💵 Sacar del banco (volver = su customId de origen).
 * Tras sacar, la pantalla muestra el efectivo nuevo.
 */
function repintar(volver, userId, guildId) {
    if (volver.startsWith("cripto_comprar_ver_")) {
        return operar.pantallaConfirmarCompra(userId, guildId, Number(volver.replace("cripto_comprar_ver_", "")));
    }
    return operar.pantallaComprar(userId, guildId);
}

module.exports = {
    ...comun,
    pestana,
    repintar,
    pantallaMercado: mercado.pantallaMercado,
    RANGOS: mercado.RANGOS,
    pantallaComprar: operar.pantallaComprar,
    pantallaConfirmarCompra: operar.pantallaConfirmarCompra,
    modalCompra: operar.modalCompra,
    pantallaVender: operar.pantallaVender,
    pantallaConfirmarVenta: operar.pantallaConfirmarVenta,
    avisoCompra: operar.avisoCompra,
    avisoVenta: operar.avisoVenta,
    IMPORTES_COMPRA: operar.IMPORTES_COMPRA,
    PORCENTAJES_VENTA: operar.PORCENTAJES_VENTA,
    pantallaCartera: cartera.pantallaCartera,
    pantallaHistorial: historial.pantallaHistorial,
};
