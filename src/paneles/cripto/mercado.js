// Pestaña 📈 Mercado de /cripto: precio, pool, último evento, quién tiene más TTCL y la gráfica con su rango.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { generateLineChart } = require("../../systems/cripto/graficos");
const mercado = require("../../systems/cripto/mercado");
const { ultimoEvento, ultimosEventos } = require("../../systems/cripto/eventos");
const { resumenPeriodo, rankingGanancias } = require("../../systems/cripto/estadisticas");
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

const pct = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2).replace(".", ",")} %`;
const signoMonedas = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtMonedas(Math.abs(n))}`;

/** El resumen del periodo elegido (#447): precios, variación y volumen, o «sin datos suficientes» si no hay precios. */
function textoResumen(r) {
    const vol = (v) => `${fmtMonedas(v.monedas)} (${mercado.formatCryptoAmt(v.ttcl)} TTCL)`;
    const volumen = `🛒 Compras: **${vol(r.compras)}** · 💸 Ventas: **${vol(r.ventas)}**`;
    if (!r.suficientes) return `Sin datos suficientes para este periodo.\n${volumen}`;
    return (
        `Inicio **${mercado.formatCoins(r.inicio)}** → fin **${mercado.formatCoins(r.fin)}** · **${pct(r.variacionPct)}**\n` +
        `Máximo **${mercado.formatCoins(r.max)}** · mínimo **${mercado.formatCoins(r.min)}**\n${volumen}`
    );
}

/** El ranking de ganancias con TTCL (#445): la realizada más la que se tiene sin vender, con el precio de la 💼 Cartera. */
function textoRankingGanancias(ranking) {
    if (!ranking.length) return "Nadie ha operado con TTCL todavía.";
    return ranking.map((r, i) => `${i + 1}. <@${r.userId}> · ${signoMonedas(r.total)}`).join("\n");
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
            { name: `📊 Resumen · ${rango.label}`, value: textoResumen(resumenPeriodo(rango.dias)), inline: false },
            { name: "📰 Último evento", value: lineaEvento(ultimoEvento()), inline: false },
            {
                name: "👥 Quién tiene más",
                value: tops.length
                    ? tops.map((t, i) => `${i + 1}. <@${t.userId}> · ${t.cantidad.toFixed(2)} TTCL`).join("\n")
                    : "Nadie todavía.",
                inline: false,
            },
            { name: "🏆 Quién gana más", value: textoRankingGanancias(rankingGanancias(5)), inline: false },
        )
        .setColor(parseInt(mercado.TTCL.color.slice(1), 16))
        .setFooter({ text: "Comisión de compra y venta: se queda en el pool. Ganancia = realizada + sin vender." });
    if (buf) embed.setImage("attachment://mercado.png");
    else embed.addFields({ name: "📊 Gráfica", value: "Todavía no hay suficiente historial para dibujarla.", inline: false });

    if (mercado.mercadoPausado(guildId)) embed.addFields({ name: "⏸️ Mercado en pausa", value: mercado.MENSAJE_PAUSA, inline: false });

    const rangos = new ActionRowBuilder().addComponents(
        RANGOS.map((r) =>
            new ButtonBuilder()
                .setCustomId(`cripto_rango_${r.dias}`)
                .setLabel(r.label)
                .setStyle(r.dias === rango.dias ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );
    const masInfo = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cripto_eventos").setLabel("📰 Eventos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("criptoord_ordenes").setLabel("🔔 Alertas y órdenes").setStyle(ButtonStyle.Secondary),
    );

    return pantalla({ embeds: [embed], filas: [rangos, masInfo], actual: "mercado", files });
}

/** Los últimos 10 eventos diarios de TTCL ya aplicados: fecha, dirección y porcentaje (#449). */
function pantallaEventos() {
    const eventos = ultimosEventos(10);
    const embed = new EmbedBuilder()
        .setTitle("📰 Eventos de $TTCL")
        .setColor(parseInt(mercado.TTCL.color.slice(1), 16))
        .setDescription(
            eventos.length
                ? eventos
                      .map(
                          (ev) =>
                              `${lineaEvento(ev)} · ${mercado.formatCoins(ev.precio_antes)} → ${mercado.formatCoins(ev.precio_despues)}`,
                      )
                      .join("\n")
                : "Todavía no ha habido ningún evento.",
        )
        .setFooter({ text: "Un evento al día, a una hora aleatoria. Los últimos 10." });
    const volver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cripto_tab_mercado").setLabel("◀ Mercado").setStyle(ButtonStyle.Secondary),
    );
    return pantalla({ embeds: [embed], filas: [volver], actual: "mercado" });
}

module.exports = { pantallaMercado, pantallaEventos, lineaEvento, textoResumen, textoRankingGanancias, RANGOS };
