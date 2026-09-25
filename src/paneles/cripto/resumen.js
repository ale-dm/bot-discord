// Paneles de /cripto para mirar: principal, precios y cartera (con el gráfico de reparto).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { generateDonutChart } = require("../../systems/cripto/graficos");
const {
    TTCL,
    REAL_CRYPTOS,
    COINS_PER_EUR,
    ttclCirculacion,
    getTtclPrecio,
    fetchGeckoPrices,
    formatCoins,
    formatCryptoAmt,
    getUserSaldo,
    getUserCarteras,
    cryptoInfoBySymbol,
    valorarCartera,
} = require("../../systems/cripto/mercado");
const { backButton } = require("./comun");

// ─── PANEL PRINCIPAL ─────────────────────────────────────────────────────────

async function buildMainPanel(userId, guildId = null) {
    const saldo = getUserSaldo(userId);
    const prices = await fetchGeckoPrices();
    const ttclP = getTtclPrecio(guildId);
    const circ = ttclCirculacion();

    // ── Cartera del usuario
    const cartera = getUserCarteras(userId);
    let totalCripto = 0;
    const holdingLines = [];
    for (const row of cartera) {
        const ci = cryptoInfoBySymbol(row.cripto);
        const pCoins = row.cripto === "TTCL" ? ttclP : (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
        const val = row.cantidad * pCoins;
        totalCripto += val;
        holdingLines.push(`${ci?.emoji || "💰"} **${row.cripto}** ${formatCryptoAmt(row.cantidad)} · ${formatCoins(val)} 🪙`);
    }
    const totalNeto = saldo + totalCripto;

    // ── Snapshot de mercado (TTCL + BTC + ETH + SOL)
    const marketPairs = [
        { sym: "TTCL", eur: null, coins: ttclP, emoji: "🟣" },
        { sym: "BTC", eur: prices["bitcoin"]?.eur, coins: (prices["bitcoin"]?.eur || 0) * COINS_PER_EUR, emoji: "🟡" },
        { sym: "ETH", eur: prices["ethereum"]?.eur, coins: (prices["ethereum"]?.eur || 0) * COINS_PER_EUR, emoji: "🔷" },
        { sym: "SOL", eur: prices["solana"]?.eur, coins: (prices["solana"]?.eur || 0) * COINS_PER_EUR, emoji: "🟢" },
    ];
    const marketLines = marketPairs
        .filter((m) => m.coins > 0)
        .map((m) => {
            const eurStr = m.eur ? ` _(${m.eur.toLocaleString("es", { maximumFractionDigits: 0 })} €)_` : ` _(circ: ${circ.toFixed(0)})_`;
            return `${m.emoji} **${m.sym}** ${formatCoins(m.coins)} 🪙${eurStr}`;
        });

    // ── Build embed
    const descParts = [];

    // Resumen financiero
    descParts.push(
        `**💵 Efectivo:** ${saldo.toLocaleString("es")} 🪙`,
        `**📊 Valor en cripto:** ${formatCoins(totalCripto)} 🪙`,
        `**💎 Total combinado:** ${formatCoins(totalNeto)} 🪙`,
    );

    // Cartera
    if (holdingLines.length) {
        descParts.push("", "**── Tus posiciones ──**", ...holdingLines);
    } else {
        descParts.push("", "_Sin posiciones abiertas. ¡Empieza comprando con 🛒!_");
    }

    // Mercado
    if (marketLines.length) {
        descParts.push("", "**── Mercado ahora ──**", ...marketLines);
    }

    const embed = new EmbedBuilder()
        .setTitle("🏠 Cripto — Tu resumen")
        .setDescription(descParts.join("\n"))
        .setColor(0x9b59b6)
        .setFooter({ text: "1 € = 1.000 🪙 · Precios CoinGecko" })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cripto_precios").setLabel("📈 Precios").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cripto_cartera").setLabel("💼 Mi Cartera").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cripto_comprar").setLabel("🛒 Comprar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("cripto_vender").setLabel("💸 Vender").setStyle(ButtonStyle.Danger),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cripto_grafico").setLabel("📊 Gráfico").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cripto_top").setLabel("🏆 Top Holders").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cripto_historial").setLabel("📜 Historial").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cripto_info").setLabel("ℹ️ Info $TTCL").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row1, row2] };
}

// ─── PRECIOS ──────────────────────────────────────────────────────────────────

async function buildPreciosPanel(guildId = null) {
    const prices = await fetchGeckoPrices();
    const ttclPrecio = getTtclPrecio(guildId);
    const circ = ttclCirculacion();

    const lines = [
        `🟣 **$TTCL** — \`${ttclPrecio.toFixed(4)}\` 🪙  _(circ: ${circ.toFixed(2)} / ${TTCL.ofertaTotal.toLocaleString("es")})_`,
    ];
    for (const c of REAL_CRYPTOS) {
        const eur = prices[c.id]?.eur;
        if (eur) {
            const coins = eur * COINS_PER_EUR;
            lines.push(
                `${c.emoji} **${c.simbolo}** — \`${coins.toLocaleString("es", { maximumFractionDigits: 0 })} 🪙\`  _(≈ ${eur.toLocaleString("es", { maximumFractionDigits: 2 })} €)_`,
            );
        } else {
            lines.push(`${c.emoji} **${c.simbolo}** — _sin datos_`);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("📈 Precios actuales")
        .setDescription(lines.join("\n"))
        .setColor(0x27ae60)
        .setFooter({ text: "CoinGecko — caché 60 s · 1 € = 1.000 🪙" })
        .setTimestamp();

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
    };
}

// ─── CARTERA ──────────────────────────────────────────────────────────────────

async function buildCarteraPanel(userId, guildId = null) {
    const saldo = getUserSaldo(userId);
    const { lineas, total: totalValue } = await valorarCartera(userId, guildId);
    const lines = lineas.map(
        (l) => `${l.info?.emoji || "💰"} **${l.cripto}** — ${formatCryptoAmt(l.cantidad)} ≈ ${formatCoins(l.valor)} 🪙`,
    );

    const embed = new EmbedBuilder()
        .setTitle("💼 Mi Cartera")
        .setDescription(
            lines.length
                ? `${lines.join("\n")}\n\n**Valor total en cripto:** ${formatCoins(totalValue)} 🪙\n**💵 Efectivo:** ${saldo.toLocaleString("es")} 🪙`
                : "No tienes ninguna criptomoneda todavía. ¡Empieza comprando con el botón 🛒!",
        )
        .setColor(0x8e44ad)
        .setTimestamp();

    const files = [];
    if (lines.length) {
        const donut = await generateDonutChart(userId, guildId);
        if (donut) {
            const att = new AttachmentBuilder(donut, { name: "cartera.png" });
            embed.setImage("attachment://cartera.png");
            files.push(att);
        }
    }

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
        files,
    };
}

module.exports = { buildMainPanel, buildPreciosPanel, buildCarteraPanel };
