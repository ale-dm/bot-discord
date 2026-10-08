// Gráficos de /cripto: línea de precio de TTCL y donut de la cartera. ECharts dibuja la gráfica en SVG (sin navegador)
// y resvg la convierte en PNG. La fuente va en assets/fonts, así el texto se ve igual en local y en Docker.
const path = require("path");
const db = require("../../core/db");
const { logWarn } = require("../../core/logger");
const { ALL_CRYPTOS, getTtclPrecio, fetchCryptoHistory, formatCoins } = require("./mercado");

const FONDO = "#0d1117";
const TEXTO = "#c9d1d9";
const TEXTO_SUAVE = "#8b949e";
const REJILLA = "#21262d";

// El emoji 🪙 no tiene glifo en la fuente de las gráficas: se escribe la unidad.
const monedas = (n) => `${formatCoins(n)} monedas`;
const FUENTES = [
    path.join(__dirname, "../../../assets/fonts/Outfit-Regular.ttf"),
    path.join(__dirname, "../../../assets/fonts/Outfit-Bold.ttf"),
];

/** Opción de ECharts → PNG. Cada gráfica crea y destruye su propio chart. */
function renderPng(option, width, height) {
    const echarts = require("echarts");
    const { Resvg } = require("@resvg/resvg-js");
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
    try {
        chart.setOption({ animation: false, backgroundColor: FONDO, textStyle: { fontFamily: "Outfit" }, ...option });
        const svg = chart.renderToSVGString();
        const render = new Resvg(svg, {
            font: { fontFiles: FUENTES, loadSystemFonts: false, defaultFontFamily: "Outfit" },
        }).render();
        return render.asPng();
    } finally {
        chart.dispose();
    }
}

const fmtFecha = (rango) => (t) => {
    const d = new Date(t);
    const opts = rango <= 1 ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" };
    return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", ...opts });
};

async function generateLineChart(cryptoId, days, labelText, hexColor) {
    try {
        let history = await fetchCryptoHistory(cryptoId, days);
        if (!history || history.length < 2) return null;
        if (history.length > 400) {
            const step = Math.ceil(history.length / 400);
            history = history.filter((_, i) => i % step === 0 || i === history.length - 1);
        }

        const primero = history[0].p;
        const ultimo = history.at(-1).p;
        const cambio = primero ? ((ultimo - primero) / primero) * 100 : 0;
        const subida = ultimo >= primero;
        const linea = subida ? "#26a69a" : "#ef5350";
        const cambioTxt = `${cambio >= 0 ? "+" : ""}${cambio.toFixed(2)} %`;
        const datos = history.map((h) => [h.t, h.p]);

        return renderPng(
            {
                title: {
                    text: labelText,
                    subtext: `${monedas(ultimo)}  ·  ${cambioTxt}`,
                    left: 40,
                    top: 24,
                    textStyle: { color: TEXTO, fontSize: 22, fontWeight: "bold" },
                    subtextStyle: { color: subida ? "#26a69a" : "#ef5350", fontSize: 15 },
                },
                grid: { left: 90, right: 120, top: 100, bottom: 60 },
                xAxis: {
                    type: "time",
                    axisLine: { lineStyle: { color: REJILLA } },
                    axisTick: { show: false },
                    axisLabel: { color: TEXTO_SUAVE, fontSize: 12, formatter: fmtFecha(days) },
                    splitLine: { show: false },
                },
                yAxis: {
                    type: "value",
                    scale: true,
                    axisLabel: { color: TEXTO_SUAVE, fontSize: 12, formatter: (v) => formatCoins(v) },
                    splitLine: { lineStyle: { color: REJILLA } },
                },
                series: [
                    {
                        type: "line",
                        data: datos,
                        showSymbol: false,
                        smooth: 0.3,
                        lineStyle: { color: linea, width: 3 },
                        areaStyle: {
                            color: {
                                type: "linear",
                                x: 0,
                                y: 0,
                                x2: 0,
                                y2: 1,
                                colorStops: [
                                    { offset: 0, color: `${linea}55` },
                                    { offset: 1, color: `${linea}00` },
                                ],
                            },
                        },
                        markPoint: {
                            symbol: "circle",
                            symbolSize: 9,
                            itemStyle: { color: linea, borderColor: FONDO, borderWidth: 2 },
                            label: { color: TEXTO, fontSize: 12, formatter: () => formatCoins(ultimo), position: "right" },
                            data: [{ coord: datos.at(-1) }],
                        },
                    },
                ],
                color: [hexColor || "#9b59b6"],
            },
            1000,
            440,
        );
    } catch (e) {
        logWarn("[Cripto] No se pudo dibujar la gráfica de precio: " + e.message);
        return null;
    }
}

async function generateDonutChart(userId) {
    try {
        const cartera = db.prepare("SELECT cripto, cantidad FROM cripto_carteras WHERE userId = ? AND cantidad > 0").all(userId);
        if (!cartera.length) return null;

        const ttclPrecio = getTtclPrecio();
        const segmentos = cartera
            .map((row) => {
                const ci = ALL_CRYPTOS.find((c) => c.simbolo === row.cripto);
                const valor = row.cantidad * (row.cripto === "TTCL" ? ttclPrecio : 0);
                return { nombre: row.cripto, valor, color: ci?.color || "#888" };
            })
            .filter((s) => s.valor > 0);
        if (!segmentos.length) return null;

        const total = segmentos.reduce((s, x) => s + x.valor, 0);
        const porcentaje = (v) => ((v / total) * 100).toFixed(1);
        const leyenda = Object.fromEntries(segmentos.map((s) => [s.nombre, `${s.nombre}  ${porcentaje(s.valor)} % · ${monedas(s.valor)}`]));

        return renderPng(
            {
                title: {
                    text: "TOTAL",
                    subtext: monedas(total),
                    left: "28%",
                    top: "middle",
                    textAlign: "center",
                    textStyle: { color: TEXTO_SUAVE, fontSize: 13 },
                    subtextStyle: { color: TEXTO, fontSize: 20, fontWeight: "bold" },
                },
                legend: {
                    orient: "vertical",
                    right: 20,
                    top: "middle",
                    icon: "circle",
                    itemWidth: 14,
                    itemHeight: 14,
                    textStyle: { color: TEXTO, fontSize: 14 },
                    formatter: (nombre) => leyenda[nombre] || nombre,
                },
                series: [
                    {
                        type: "pie",
                        radius: ["46%", "66%"],
                        center: ["28%", "50%"],
                        label: { show: false },
                        labelLine: { show: false },
                        itemStyle: { borderColor: FONDO, borderWidth: 3 },
                        data: segmentos.map((s) => ({ name: s.nombre, value: s.valor, itemStyle: { color: s.color } })),
                    },
                ],
            },
            520,
            400,
        );
    } catch (e) {
        logWarn("[Cripto] No se pudo dibujar el donut de la cartera: " + e.message);
        return null;
    }
}

module.exports = { generateLineChart, generateDonutChart, renderPng, FONDO, TEXTO, TEXTO_SUAVE, REJILLA };
