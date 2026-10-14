// Los DM de las órdenes de TTCL (alertas, stop-loss y compras recurrentes). Las reglas están en systems/cripto/ordenes.
const { EmbedBuilder } = require("discord.js");
const mercado = require("../../systems/cripto/mercado");

const embed = (titulo, descripcion, color) => ({
    embeds: [new EmbedBuilder().setTitle(titulo).setDescription(descripcion).setColor(color).setTimestamp()],
});
const moneda = (n) => `${Math.round(n).toLocaleString("es")} monedas`;

const mensajes = {
    /** La alerta de precio ha saltado. */
    alerta: (orden, precio) =>
        embed(
            "🔔 Alerta de precio del TTCL",
            `El ${mercado.TTCL.emoji} TTCL ha ${orden.sobre ? "subido hasta" : "bajado hasta"} **${mercado.formatCoins(precio)}** monedas (tu objetivo: ${mercado.formatCoins(orden.precio)}).`,
            0xf1c40f,
        ),

    /** El stop-loss ha vendido (r.ok) o se ha cancelado por no haber TTCL. */
    stoploss: (orden, r) =>
        r.ok
            ? embed(
                  "🛡️ Stop-loss ejecutado",
                  `El precio bajó a tu umbral (${mercado.formatCoins(orden.precio)}): he vendido **${mercado.formatCryptoAmt(r.cantidad)} TTCL** por **${moneda(r.monedas)}** (comisión ${moneda(r.fee)}).`,
                  0xe74c3c,
              )
            : embed(
                  "🛡️ Stop-loss cancelado",
                  "El precio bajó a tu umbral pero ya no tenías TTCL en cartera, así que he cancelado la orden.",
                  0x95a5a6,
              ),

    /** Una compra recurrente no se ha podido hacer: se salta el ciclo. */
    recurrente: (orden, r, proxima) =>
        embed(
            "🔁 Compra recurrente saltada",
            `No he podido comprar **${moneda(orden.monedas)}** de TTCL: ${r.msg}\nLo intento de nuevo <t:${Math.floor(proxima / 1000)}:f>.`,
            0xe67e22,
        ),
};

module.exports = mensajes;
