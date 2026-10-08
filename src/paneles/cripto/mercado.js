// Pestaña 📈 Mercado de /cripto: precio, pool, último evento, quién tiene más TTCL y la gráfica con su rango.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { generateLineChart } = require("../../systems/cripto/graficos");
const mercado = require("../../systems/cripto/mercado");
const { ultimoEvento } = require("../../systems/cripto/eventos");
const { pantalla, fmtMonedas, fechaMadrid } = require("./comun");

const RANGOS = [
    { dias: 1, label: "24 h" },
    { dias: 7, label: "7 días" },
    { dias: 30, label: "30 días" },
    { dias: 365, label: "Todo" },
];

function lineaEvento(ev) {
    if (!ev) return "Todavía no ha habido ninguno.";
    const sube = ev.direccion === "subida";
    return `${sube ? "📈 Sube" : "📉 Baja"} un **${ev.porcentaje} %** · ${fechaMadrid(ev.aplicado_en)}`;
}

async function pantallaMercado(guildId, dias = 7) {
    const precio = mercado.getTtclPrecio();
    const pool = mercado.leerPool();
    const enCarteras = mercado.ttclCirculacion();
    const tops = mercado.topTenedoresTtcl(5);
    const rango = RANGOS.find((r) => r.dias === dias) || RANGOS[1];

    const buf = await generateLineChart("TTCL", rango.dias, `$TTCL — ${rango.label}`, mercado.TTCL.color);
    const files = buf ? [new AttachmentBuilder(buf, { name: "mercado.png" })] : [];

    const embed = new EmbedBuilder()
        .setTitle("📈 Mercado de $TTCL")
        .setDescription(`**Precio:** ${precio.toFixed(2)} monedas · **En carteras:** ${enCarteras.toFixed(2)} TTCL`)
        .addFields(
            { name: "💧 Pool", value: `${fmtMonedas(pool.monedas)} · ${pool.ttcl.toFixed(2)} TTCL`, inline: false },
            { name: "📰 Último evento", value: lineaEvento(ultimoEvento()), inline: false },
            {
                name: "👥 Quién tiene más",
                value: tops.length
                    ? tops.map((t, i) => `${i + 1}. <@${t.userId}> · ${t.cantidad.toFixed(2)} TTCL`).join("\n")
                    : "Nadie todavía.",
                inline: false,
            },
        )
        .setColor(parseInt(mercado.TTCL.color.slice(1), 16))
        .setFooter({ text: "Comisión de compra y venta: se queda en el pool." });
    if (buf) embed.setImage("attachment://mercado.png");
    else embed.addFields({ name: "📊 Gráfica", value: "Todavía no hay suficiente historial para dibujarla.", inline: false });

    const rangos = new ActionRowBuilder().addComponents(
        RANGOS.map((r) =>
            new ButtonBuilder()
                .setCustomId(`cripto_rango_${r.dias}`)
                .setLabel(r.label)
                .setStyle(r.dias === rango.dias ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );

    return pantalla({ embeds: [embed], filas: [rangos], actual: "mercado", files });
}

module.exports = { pantallaMercado, RANGOS };
