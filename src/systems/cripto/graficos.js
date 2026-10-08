// Gráficos de /cripto con canvas: línea de precio y donut de la cartera.
const db = require("../../core/db");
const { logWarn } = require("../../core/logger");
const { ALL_CRYPTOS, getTtclPrecio, fetchCryptoHistory, formatCoins } = require("./mercado");

// ─── CANVAS: GRÁFICO DE LÍNEA ─────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function generateLineChart(cryptoId, days, labelText, hexColor, guildId = null) {
    try {
        const { createCanvas } = require("canvas");
        let history = await fetchCryptoHistory(cryptoId, days);
        if (!history || history.length < 2) return null;
        if (history.length > 400) {
            const step = Math.ceil(history.length / 400);
            history = history.filter((_, i) => i % step === 0 || i === history.length - 1);
        }

        const W = 1000,
            H = 440;
        // left: espacio Y labels | right: espacio badge precio | top: cabecera | bottom: eje X
        const PAD = { top: 88, right: 115, bottom: 56, left: 88 };
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext("2d");

        // ── Fondo
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, W, H);

        const prices = history.map((h) => h.p);
        const times = history.map((h) => h.t);
        const firstP = prices[0];
        const lastP = prices.at(-1);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        const range = maxP - minP || 1;
        const pMin = minP - range * 0.08;
        const pMax = maxP + range * 0.08;
        const plotW = W - PAD.left - PAD.right;
        const plotH = H - PAD.top - PAD.bottom;

        const xS = (i) => PAD.left + (i / (prices.length - 1)) * plotW;
        const yS = (p) => PAD.top + (1 - (p - pMin) / (pMax - pMin)) * plotH;

        const isUp = lastP >= firstP;
        const lineColor = isUp ? "#26a69a" : "#ef5350";
        // rgba para compatibilidad total con node-canvas
        const rgbaA = isUp ? "rgba(38,166,154,0.28)" : "rgba(239,83,80,0.28)";
        const rgbaB = isUp ? "rgba(38,166,154,0.04)" : "rgba(239,83,80,0.04)";
        const rgbaMid = isUp ? "rgba(38,166,154,0.10)" : "rgba(239,83,80,0.10)";

        // ── Grid vertical
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            const x = PAD.left + (i / 6) * plotW;
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.beginPath();
            ctx.moveTo(x, PAD.top);
            ctx.lineTo(x, PAD.top + plotH);
            ctx.stroke();
        }

        // ── Grid horizontal + etiquetas Y
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        for (let i = 0; i <= 5; i++) {
            const y = PAD.top + (i / 5) * plotH;
            const val = pMax - (pMax - pMin) * (i / 5);
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.beginPath();
            ctx.moveTo(PAD.left, y);
            ctx.lineTo(PAD.left + plotW, y);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.40)";
            ctx.fillText(formatCoins(val), PAD.left - 6, y + 4);
        }
        ctx.setLineDash([]);

        // ── Área rellena (degradado rgba)
        ctx.beginPath();
        ctx.moveTo(xS(0), yS(prices[0]));
        for (let i = 1; i < prices.length; i++) ctx.lineTo(xS(i), yS(prices[i]));
        ctx.lineTo(xS(prices.length - 1), PAD.top + plotH);
        ctx.lineTo(xS(0), PAD.top + plotH);
        ctx.closePath();
        const areaGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
        areaGrad.addColorStop(0, rgbaA);
        areaGrad.addColorStop(0.5, rgbaMid);
        areaGrad.addColorStop(1, rgbaB);
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // ── Línea principal (glow en 4 capas, siempre rgba para consistencia)
        const [r_, g_, b_] = isUp ? [38, 166, 154] : [239, 83, 80];
        const layers = [
            [8, 0.06],
            [4, 0.16],
            [2.5, 0.5],
            [1.5, 1.0],
        ];
        for (const [lw, a] of layers) {
            ctx.beginPath();
            ctx.moveTo(xS(0), yS(prices[0]));
            for (let i = 1; i < prices.length; i++) ctx.lineTo(xS(i), yS(prices[i]));
            ctx.strokeStyle = `rgba(${r_},${g_},${b_},${a})`;
            ctx.lineWidth = lw;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
        }

        // ── Línea horizontal precio actual (dashed)
        const cyPrice = yS(lastP);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = lineColor + "80";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, cyPrice);
        ctx.lineTo(PAD.left + plotW, cyPrice);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── Badge precio en eje Y (auto-ancho)
        ctx.font = "bold 11px sans-serif";
        const priceLabel = formatCoins(lastP);
        const priceLabelW = ctx.measureText(priceLabel).width;
        const yBadgeW = priceLabelW + 18;
        const yBadgeH = 22;
        const yBadgeX = PAD.left + plotW + 4;
        const yBadgeY = cyPrice - yBadgeH / 2;
        ctx.fillStyle = lineColor;
        roundRect(ctx, yBadgeX, yBadgeY, yBadgeW, yBadgeH, 4);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(priceLabel, yBadgeX + 9, yBadgeY + 15);

        // ── Etiquetas eje X
        ctx.textAlign = "center";
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        const xCount = Math.min(7, prices.length);
        for (let i = 0; i < xCount; i++) {
            const idx = Math.floor((i / (xCount - 1)) * (prices.length - 1));
            const d = new Date(times[idx]);
            const lbl =
                days <= 1
                    ? d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
                    : d.toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
            ctx.fillText(lbl, xS(idx), H - PAD.bottom + 18);
        }

        // ── Bordes del área de plot
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, PAD.top + plotH);
        ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PAD.left, PAD.top);
        ctx.lineTo(PAD.left, PAD.top + plotH);
        ctx.stroke();

        // ── Punto final con halo
        const ex = xS(prices.length - 1),
            ey = yS(lastP);
        ctx.fillStyle = `rgba(${r_},${g_},${b_},0.18)`;
        ctx.beginPath();
        ctx.arc(ex, ey, 10, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = `rgba(${r_},${g_},${b_},0.40)`;
        ctx.beginPath();
        ctx.arc(ex, ey, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, 2 * Math.PI);
        ctx.fill();

        // ── Cabecera ──────────────────────────────────────────────────────────
        const pctChange = ((lastP - firstP) / firstP) * 100;
        const pctText = (pctChange >= 0 ? "+" : "") + pctChange.toFixed(2) + "%";
        const arrow = pctChange >= 0 ? "▲" : "▼";

        // Nombre / par
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.50)";
        ctx.font = "13px sans-serif";
        ctx.fillText(labelText, PAD.left, 22);

        // Precio grande — medir ANTES de dibujar para colocar badge correctamente
        ctx.font = "bold 28px sans-serif";
        const priceFullTxt = formatCoins(lastP);
        const priceFullW = ctx.measureText(priceFullTxt).width;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(priceFullTxt, PAD.left, 62);

        // Badge % (coloreado, junto al precio)
        const badgeTxt = `${arrow} ${pctText}`;
        ctx.font = "bold 13px sans-serif";
        const bw = ctx.measureText(badgeTxt).width + 20;
        const bh = 24;
        const bx = PAD.left + priceFullW + 12;
        const by = 42;
        ctx.fillStyle = isUp ? "rgba(38,166,154,0.20)" : "rgba(239,83,80,0.20)";
        roundRect(ctx, bx, by, bw, bh, 5);
        ctx.fill();
        ctx.fillStyle = lineColor;
        ctx.textAlign = "left";
        ctx.fillText(badgeTxt, bx + 10, by + 17);

        // ── Stats (MAX / MIN / Inicio) — esquina superior derecha, columnas auto-ancho
        const stats = [
            { label: "MAX", value: formatCoins(maxP) },
            { label: "MIN", value: formatCoins(minP) },
            { label: "Inicio", value: formatCoins(firstP) },
        ];
        // calcular el ancho máximo de cada columna para que no se solapen
        ctx.font = "bold 12px sans-serif";
        const statColW = Math.max(...stats.map((s) => ctx.measureText(s.value).width)) + 24;
        const statRight = W - 14;
        ctx.textAlign = "right";
        for (let i = 0; i < stats.length; i++) {
            const sx = statRight - i * statColW;
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.font = "10px sans-serif";
            ctx.fillText(stats[i].label, sx, 22);
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.font = "bold 12px sans-serif";
            ctx.fillText(stats[i].value, sx, 42);
        }

        // ── Separador cabecera / gráfico
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, PAD.top - 6);
        ctx.lineTo(statRight, PAD.top - 6);
        ctx.stroke();

        return canvas.toBuffer("image/png");
    } catch (e) {
        logWarn("[Cripto] generateLineChart error: " + e.message);
        return null;
    }
}

// ─── CANVAS: GRÁFICO DONUT ────────────────────────────────────────────────────

async function generateDonutChart(userId, guildId = null) {
    try {
        const { createCanvas } = require("canvas");
        const cartera = db.prepare("SELECT cripto, cantidad FROM cripto_carteras WHERE userId = ? AND cantidad > 0").all(userId);
        if (!cartera.length) return null;

        const ttclPrecio = getTtclPrecio();

        const segments = [];
        for (const row of cartera) {
            const ci = ALL_CRYPTOS.find((c) => c.simbolo === row.cripto);
            const pCoins = row.cripto === "TTCL" ? ttclPrecio : 0;
            const val = row.cantidad * pCoins;
            if (val > 0) segments.push({ label: row.cripto, value: val, color: ci?.color || "#888" });
        }
        if (!segments.length) return null;

        const total = segments.reduce((s, x) => s + x.value, 0);
        const W = 520,
            H = 400;
        const CX = 165,
            CY = 200,
            OUTER = 130,
            INNER = 72;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#16213e";
        ctx.fillRect(0, 0, W, H);

        let startAngle = -Math.PI / 2;
        for (const seg of segments) {
            const sweep = (seg.value / total) * 2 * Math.PI;
            const endAngle = startAngle + sweep;
            ctx.shadowBlur = 16;
            ctx.shadowColor = seg.color;
            ctx.beginPath();
            ctx.moveTo(CX + INNER * Math.cos(startAngle), CY + INNER * Math.sin(startAngle));
            ctx.arc(CX, CY, OUTER, startAngle, endAngle);
            ctx.arc(CX, CY, INNER, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();
            ctx.shadowBlur = 0;
            startAngle = endAngle;
        }

        // Agujero central
        ctx.fillStyle = "#16213e";
        ctx.beginPath();
        ctx.arc(CX, CY, INNER - 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("TOTAL", CX, CY - 9);
        ctx.fillStyle = "#f1c40f";
        ctx.font = "bold 11px monospace";
        ctx.fillText(formatCoins(total) + " 🪙", CX, CY + 9);

        // Leyenda
        ctx.textAlign = "left";
        segments.forEach((seg, i) => {
            const y = 75 + i * 38;
            ctx.fillStyle = seg.color;
            ctx.fillRect(318, y - 11, 14, 14);
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px monospace";
            ctx.fillText(seg.label, 338, y);
            ctx.fillStyle = "rgba(255,255,255,0.58)";
            const pct = ((seg.value / total) * 100).toFixed(1);
            ctx.fillText(`${pct}% — ${formatCoins(seg.value)} 🪙`, 338, y + 16);
        });

        return canvas.toBuffer("image/png");
    } catch (e) {
        logWarn("[Cripto] generateDonutChart error: " + e.message);
        return null;
    }
}

module.exports = { generateLineChart, generateDonutChart };
