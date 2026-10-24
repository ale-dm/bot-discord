// 📊 Lo que se ve de las estadísticas (#538): la gráfica de barras de una métrica día a día (ECharts → PNG con el mismo
// renderizador que /cripto, que crea y destruye el chart cada vez) y el resumen en texto: total, media, mejor día y variación
// respecto al periodo anterior. `opcionGrafica` y `textoResumen` no dibujan nada, así se prueban sin renderizar.
const { METRICAS } = require("../systems/estadisticas");

const COLOR_BARRA = "#58a6ff";

const numero = (n) => Number(n).toLocaleString("es", { maximumFractionDigits: 1 });
const diaCorto = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** La opción de ECharts de un periodo. */
function opcionGrafica(p, colores = {}) {
    const m = METRICAS[p.metrica];
    return {
        title: {
            text: `${m.nombre} · últimos ${p.dias} días`,
            left: "center",
            top: 12,
            textStyle: { color: colores.texto || "#c9d1d9", fontSize: 20 },
        },
        grid: { left: 70, right: 30, top: 60, bottom: 50 },
        xAxis: {
            type: "category",
            data: p.serie.map((d) => diaCorto(d.dia)),
            axisLabel: { color: colores.suave || "#8b949e", interval: p.dias > 31 ? 6 : p.dias > 7 ? 2 : 0 },
            axisLine: { lineStyle: { color: colores.rejilla || "#21262d" } },
        },
        yAxis: {
            type: "value",
            axisLabel: { color: colores.suave || "#8b949e" },
            splitLine: { lineStyle: { color: colores.rejilla || "#21262d" } },
        },
        series: [{ type: "bar", data: p.serie.map((d) => d.valor), itemStyle: { color: COLOR_BARRA, borderRadius: [3, 3, 0, 0] } }],
    };
}

/** El resumen en texto, para el embed. */
function textoResumen(p) {
    const m = METRICAS[p.metrica];
    const r = p.resumen;
    const variacion =
        r.variacion === null
            ? "sin datos del periodo anterior"
            : `${r.variacion > 0 ? "📈 +" : r.variacion < 0 ? "📉 " : "➖ "}${numero(r.variacion)} % respecto a los ${p.dias} días anteriores`;
    return [
        `**Total:** ${numero(r.total)} ${m.unidad}`,
        `**Media diaria:** ${numero(r.media)}`,
        `**Mejor día:** ${r.mejor ? `${diaCorto(r.mejor.dia)} (${numero(r.mejor.valor)})` : "ninguno"}`,
        `**Variación:** ${variacion}`,
        ...(m.global ? ["-# El historial de dinero es de todo el bot, no solo de este servidor."] : []),
    ].join("\n");
}

/** La imagen PNG del periodo. `render` se inyecta en los tests. */
function imagen(p, render = null) {
    const graficos = require("../systems/cripto/graficos");
    const dibujar = render || graficos.renderPng;
    return dibujar(opcionGrafica(p, { texto: graficos.TEXTO, suave: graficos.TEXTO_SUAVE, rejilla: graficos.REJILLA }), 1000, 500);
}

module.exports = { opcionGrafica, textoResumen, imagen };
