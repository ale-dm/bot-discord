// Paneles de /cripto de consulta: gráficos de precio, top de holders, historial e info de $TTCL.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const db = require("../../core/db");
const { generateLineChart } = require("../../systems/cripto/graficos");
const {
    RANGE_OPTIONS,
    leerPool,
    ttclCirculacion,
    getTtclPrecio,
    formatCoins,
    formatCryptoAmt,
    cryptoInfoBySymbol,
} = require("../../systems/cripto/mercado");
const { backButton } = require("./comun");

// ─── GRÁFICO ─────────────────────────────────────────────────────────────────

function buildGraficoSelectPanel() {
    const embed = new EmbedBuilder()
        .setTitle("📊 Gráfico de precios")
        .setDescription("Elige la criptomoneda y el rango temporal que quieres visualizar.")
        .setColor(0x3498db);

    const cryptoRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cripto_grafico_sel")
            .setPlaceholder("Selecciona una criptomoneda")
            .addOptions([
                { label: "$TTCL — Cripto del servidor", value: "TTCL", emoji: "🟣" },
                { label: "Bitcoin (BTC)", value: "BTC", emoji: "🟡" },
                { label: "Ethereum (ETH)", value: "ETH", emoji: "🔷" },
                { label: "Solana (SOL)", value: "SOL", emoji: "🟢" },
                { label: "BNB", value: "BNB", emoji: "🟠" },
                { label: "XRP", value: "XRP", emoji: "🔵" },
                { label: "Dogecoin (DOGE)", value: "DOGE", emoji: "🐕" },
            ]),
    );

    return {
        embeds: [embed],
        components: [cryptoRow, new ActionRowBuilder().addComponents(backButton())],
    };
}

async function buildGraficoChart(sym, days, guildId = null) {
    const ci = cryptoInfoBySymbol(sym);
    if (!ci) {
        return {
            embeds: [new EmbedBuilder().setDescription("❌ Criptomoneda no reconocida.").setColor(0xe74c3c)],
            components: [],
        };
    }

    const geckoId = sym === "TTCL" ? "TTCL" : ci.id;
    const rangeLabel = RANGE_OPTIONS.find((r) => String(r.days) === String(days))?.label || `${days}d`;
    const chartLabel = `${ci.emoji} ${sym} — ${rangeLabel}`;

    const buf = await generateLineChart(geckoId, days, chartLabel, ci.color, guildId);

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${ci.emoji} ${sym} — ${rangeLabel}`)
        .setColor(parseInt((ci.color || "#3498db").replace("#", ""), 16) || 0x3498db);

    const files = [];
    if (buf) {
        const att = new AttachmentBuilder(buf, { name: "chart.png" });
        embed.setImage("attachment://chart.png");
        files.push(att);
    } else {
        const msg =
            sym === "TTCL"
                ? "⚠️ Todavía no hay suficiente historial de $TTCL.\nEl gráfico se irá construyendo a medida que los usuarios compren y vendan."
                : "⚠️ No se pudo cargar el gráfico en este momento. Inténtalo de nuevo en unos segundos.";
        embed.setDescription(msg);
    }

    // Botones de rango
    const rangeRow = new ActionRowBuilder();
    RANGE_OPTIONS.forEach((r) => {
        rangeRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`cripto_grafico_rng_${sym}_${r.days}`)
                .setLabel(r.label)
                .setStyle(String(r.days) === String(days) ? ButtonStyle.Primary : ButtonStyle.Secondary),
        );
    });

    const navRow = new ActionRowBuilder().addComponents(
        backButton("cripto_grafico", "◀ Cambiar cripto"),
        backButton("cripto_panel", "🏠 Panel principal"),
    );

    return { embeds: [embed], components: [rangeRow, navRow], files };
}

// ─── TOP HOLDERS ──────────────────────────────────────────────────────────────

async function buildTopHolders(guildId = null) {
    const ttclP = getTtclPrecio();

    const holders = db
        .prepare("SELECT userId, cantidad FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0 ORDER BY cantidad DESC LIMIT 10")
        .all();

    const medals = ["🥇", "🥈", "🥉"];
    const lines = holders.length
        ? holders.map((r, i) => {
              const val = r.cantidad * ttclP;
              const icon = medals[i] || `**${i + 1}.**`;
              return `${icon} <@${r.userId}> — ${formatCryptoAmt(r.cantidad)} $TTCL ≈ ${formatCoins(val)} 🪙`;
          })
        : ["Nadie tiene $TTCL todavía. ¡Sé el primero!"];

    const embed = new EmbedBuilder().setTitle("🏆 Top $TTCL Holders").setDescription(lines.join("\n")).setColor(0xf1c40f).setTimestamp();

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
    };
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────

function buildHistorialPanel(userId) {
    const rows = db
        .prepare(
            "SELECT tipo, cripto, cantidad, precio, monedas, timestamp FROM cripto_historial WHERE userId = ? ORDER BY timestamp DESC LIMIT 15",
        )
        .all(userId);

    const lines = rows.map((r) => {
        const date = new Date(r.timestamp).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const icon = r.tipo === "compra" ? "🟢" : "🔴";
        return `${icon} **${r.tipo.toUpperCase()}** ${formatCryptoAmt(r.cantidad)} **${r.cripto}** @ ${formatCoins(r.precio)}/u = ${formatCoins(r.monedas)} 🪙  \`${date}\``;
    });

    const embed = new EmbedBuilder()
        .setTitle("📜 Historial de operaciones")
        .setDescription(lines.length ? lines.join("\n") : "Sin operaciones todavía.")
        .setColor(0x7f8c8d)
        .setTimestamp();

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
    };
}

// ─── INFO TTCL ────────────────────────────────────────────────────────────────

function buildInfoPanel(guildId = null) {
    const pool = leerPool();
    const precio = getTtclPrecio();
    const enCarteras = ttclCirculacion();
    const marketCap = enCarteras * precio;
    const cfg = guildSettings.getSettings(guildId).cripto;

    const embed = new EmbedBuilder()
        .setTitle("ℹ️ TTCL Coin — Pool de liquidez")
        .setDescription(
            `**Símbolo:** $TTCL\n` +
                `**Precio actual:** ${precio.toFixed(2)} 🪙\n` +
                `**En carteras:** ${enCarteras.toFixed(4)} TTCL\n` +
                `**Market cap (en carteras):** ${formatCoins(marketCap)} 🪙\n\n` +
                `**Pool:** ${formatCoins(pool.monedas)} 🪙 · ${pool.ttcl.toFixed(2)} TTCL\n` +
                `**Precio = monedas del pool / TTCL del pool.** Cada compra o venta se cobra contra el pool, así que cuanto más grande es la operación, más mueve el precio.\n\n` +
                `**Comisión:** compra ${cfg.fee_buy_pct}% · venta ${cfg.fee_sell_pct}% (se queda en el pool).`,
        )
        .setColor(0x9b59b6)
        .setTimestamp();

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
    };
}

module.exports = { buildGraficoSelectPanel, buildGraficoChart, buildTopHolders, buildHistorialPanel, buildInfoPanel };
