// Pestaña 💼 Cartera de /cripto: lo que tienes de TTCL, cuánto vale, tu coste medio y la ganancia sin vender.
const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const mercado = require("../../systems/cripto/mercado");
const { generateDonutChart } = require("../../systems/cripto/graficos");
const { pantalla, fmtMonedas } = require("./comun");

async function pantallaCartera(userId) {
    const embed = new EmbedBuilder().setTitle("💼 Tu cartera").setColor(0x9b59b6);
    const tenencia = mercado.getUserCarteras(userId).find((r) => r.cripto === mercado.TTCL.simbolo)?.cantidad || 0;

    if (!(tenencia > 0)) {
        embed.setDescription("No tienes $TTCL. Cómpralo en la pestaña 🛒 Comprar.");
        return pantalla({ embeds: [embed], actual: "cartera" });
    }

    const precio = mercado.getTtclPrecio();
    const valor = tenencia * precio;
    const costeMedio = mercado.costeMedioTtcl(userId);
    const ganancia = valor - tenencia * costeMedio;

    const lineas = [
        `**Tienes:** ${mercado.formatCryptoAmt(tenencia)} TTCL`,
        `**Valor ahora:** ${fmtMonedas(valor)} (antes de la comisión de venta)`,
    ];
    if (costeMedio > 0) {
        lineas.push(`**Coste medio:** ${mercado.formatCoins(costeMedio)} monedas por TTCL`);
        lineas.push(`**Ganancia sin vender:** ${ganancia >= 0 ? "+" : "−"}${fmtMonedas(Math.abs(ganancia))}`);
    }
    embed.setDescription(lineas.join("\n"));
    embed.setFooter({ text: "Vender no paga impuestos; la comisión se queda en el pool." });

    const buf = await generateDonutChart(userId);
    const files = buf ? [new AttachmentBuilder(buf, { name: "cartera.png" })] : [];
    if (buf) embed.setImage("attachment://cartera.png");

    return pantalla({ embeds: [embed], actual: "cartera", files });
}

module.exports = { pantallaCartera };
