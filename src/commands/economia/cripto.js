const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    AttachmentBuilder,
} = require("discord.js");
const db = require("../../core/db");
const { logWarn } = require("../../core/logger");
const guildSettings = require("../../systems/guildSettings");
const mercado = require("../../systems/cripto/mercado");
const { generateLineChart, generateDonutChart } = require("../../systems/cripto/graficos");
const {
    TTCL,
    REAL_CRYPTOS,
    COINS_PER_EUR,
    RANGE_OPTIONS,
    ttclCirculacion,
    getTtclPrecio,
    fetchGeckoPrices,
    formatCoins,
    formatCryptoAmt,
    getUserSaldo,
    getUserCarteras,
    cryptoInfoBySymbol,
    ejecutarCompra,
    ejecutarVenta,
} = mercado;

// La lógica (precios, compra/venta) está en src/systems/cripto/mercado.js y los gráficos en
// src/systems/cripto/graficos.js; aquí solo los paneles y botones de Discord.

function backButton(customId = "cripto_panel", label = "◀ Volver") {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary);
}

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
        `**💵 Saldo libre:** ${saldo.toLocaleString("es")} 🪙`,
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
    const cartera = getUserCarteras(userId);
    const saldo = getUserSaldo(userId);
    const prices = await fetchGeckoPrices();
    const ttclP = getTtclPrecio(guildId);

    let totalValue = 0;
    const lines = [];
    for (const row of cartera) {
        const ci = cryptoInfoBySymbol(row.cripto);
        const pCoins = row.cripto === "TTCL" ? ttclP : (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
        const val = row.cantidad * pCoins;
        totalValue += val;
        lines.push(`${ci?.emoji || "💰"} **${row.cripto}** — ${formatCryptoAmt(row.cantidad)} ≈ ${formatCoins(val)} 🪙`);
    }

    const embed = new EmbedBuilder()
        .setTitle("💼 Mi Cartera")
        .setDescription(
            lines.length
                ? `${lines.join("\n")}\n\n**Valor total en cripto:** ${formatCoins(totalValue)} 🪙\n**Saldo libre:** ${saldo.toLocaleString("es")} 🪙`
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

// ─── COMPRAR ──────────────────────────────────────────────────────────────────

function buildComprarSelect() {
    const embed = new EmbedBuilder()
        .setTitle("🛒 Comprar — Elige una criptomoneda")
        .setDescription("Selecciona la cripto que quieres comprar.")
        .setColor(0x2ecc71);

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cripto_comprar_sel")
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
        components: [selectRow, new ActionRowBuilder().addComponents(backButton())],
    };
}

async function buildComprarCantidad(userId, sym, guildId = null) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const saldo = getUserSaldo(userId);
    const ci = cryptoInfoBySymbol(sym);

    let priceCoins;
    if (sym === "TTCL") {
        priceCoins = getTtclPrecio(guildId);
    } else {
        const prices = await fetchGeckoPrices();
        priceCoins = (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
    }

    if (!priceCoins) {
        return {
            embeds: [new EmbedBuilder().setDescription("❌ No se pudo obtener el precio. Inténtalo más tarde.").setColor(0xe74c3c)],
            components: [new ActionRowBuilder().addComponents(backButton("cripto_comprar", "◀ Volver"))],
        };
    }

    // Opciones de importe: tiers fijos + "todo el saldo" como extra
    const minBuy = Math.max(1, Number(cfg.min_buy || 100));
    const maxBuy = Math.max(minBuy, Number(cfg.max_buy || 500000));
    const tiers = [minBuy, 500, 1000, 5000, 10000, maxBuy];
    if (saldo > 10000) tiers.push(Math.min(saldo, 50000));
    const uniqueTiers = [...new Set(tiers.filter((t) => t <= saldo && t >= minBuy && t <= maxBuy))].sort((a, b) => a - b);

    if (!uniqueTiers.length) {
        return {
            embeds: [
                new EmbedBuilder()
                    .setDescription(
                        `❌ Saldo insuficiente. Tienes **${saldo} 🪙** pero el mínimo de inversión es ${minBuy.toLocaleString("es")} 🪙.`,
                    )
                    .setColor(0xe74c3c),
            ],
            components: [new ActionRowBuilder().addComponents(backButton("cripto_comprar", "◀ Volver"))],
        };
    }

    const embed = new EmbedBuilder()
        .setTitle(`🛒 Comprar ${ci?.emoji || "💰"} ${sym}`)
        .setDescription(
            `**Precio actual:** ${formatCoins(priceCoins)} 🪙 / unidad\n` +
                `**Tu saldo:** ${saldo.toLocaleString("es")} 🪙\n\n` +
                `**Política:** min ${minBuy.toLocaleString("es")} · max ${maxBuy.toLocaleString("es")} · cooldown ${Number(cfg.cooldown_buy_sec || 0)}s · fee ${Number(cfg.fee_buy_pct || 0)}%\n\n` +
                `¿Cuántas monedas quieres invertir?`,
        )
        .setColor(0x2ecc71);

    const amtRow = new ActionRowBuilder();
    uniqueTiers.slice(0, 5).forEach((t) => {
        const got = t / priceCoins;
        amtRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`cripto_comprar_exec_${sym}_${t}`)
                .setLabel(`${t.toLocaleString("es")} 🪙 ≈ ${formatCryptoAmt(got)}`)
                .setStyle(ButtonStyle.Success),
        );
    });

    return {
        embeds: [embed],
        components: [amtRow, new ActionRowBuilder().addComponents(backButton("cripto_comprar", "◀ Volver"))],
    };
}

// ─── VENDER ───────────────────────────────────────────────────────────────────

function buildVenderSelect(userId) {
    const cartera = getUserCarteras(userId);
    if (!cartera.length) {
        return {
            embeds: [new EmbedBuilder().setDescription("No tienes ninguna criptomoneda que vender.").setColor(0xe74c3c)],
            components: [new ActionRowBuilder().addComponents(backButton())],
        };
    }

    const embed = new EmbedBuilder().setTitle("💸 Vender — Elige una criptomoneda").setColor(0xe74c3c);

    const options = cartera.map((row) => {
        const ci = cryptoInfoBySymbol(row.cripto);
        return {
            label: `${ci?.simbolo || row.cripto} — ${formatCryptoAmt(row.cantidad)}`,
            value: row.cripto,
            emoji: ci?.emoji || "💰",
        };
    });

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cripto_vender_sel")
            .setPlaceholder("Selecciona una cripto para vender")
            .addOptions(options),
    );

    return {
        embeds: [embed],
        components: [selectRow, new ActionRowBuilder().addComponents(backButton())],
    };
}

async function buildVenderPct(userId, sym, guildId = null) {
    const cfg = guildSettings.getSettings(guildId).cripto;
    const row = db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = ?").get(userId, sym);

    if (!row || row.cantidad <= 0) {
        return {
            embeds: [new EmbedBuilder().setDescription("No tienes esa cripto en cartera.").setColor(0xe74c3c)],
            components: [new ActionRowBuilder().addComponents(backButton("cripto_vender", "◀ Volver"))],
        };
    }

    const ci = cryptoInfoBySymbol(sym);
    let priceCoins;
    if (sym === "TTCL") {
        priceCoins = getTtclPrecio(guildId);
    } else {
        const prices = await fetchGeckoPrices();
        priceCoins = (prices[ci?.id]?.eur || 0) * COINS_PER_EUR;
    }

    const totalVal = row.cantidad * (priceCoins || 0);
    const embed = new EmbedBuilder()
        .setTitle(`💸 Vender ${ci?.emoji || "💰"} ${sym}`)
        .setDescription(
            `**Tienes:** ${formatCryptoAmt(row.cantidad)} ${sym} ≈ ${formatCoins(totalVal)} 🪙\n` +
                `**Precio actual:** ${formatCoins(priceCoins || 0)} 🪙 / unidad\n\n` +
                `**Política:** min ${Number(cfg.min_sell || 0).toLocaleString("es")} · max ${Number(cfg.max_sell || 0).toLocaleString("es")} · cooldown ${Number(cfg.cooldown_sell_sec || 0)}s · fee ${Number(cfg.fee_sell_pct || 0)}%\n\n` +
                `¿Qué porcentaje quieres vender?`,
        )
        .setColor(0xe74c3c);

    const pcts = [10, 25, 50, 75, 100];
    const pctRow = new ActionRowBuilder();
    pcts.forEach((pct) => {
        const coins = Math.floor(row.cantidad * (pct / 100) * (priceCoins || 0));
        pctRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`cripto_vender_exec_${sym}_${pct}`)
                .setLabel(`${pct}% ≈ ${formatCoins(coins)} 🪙`)
                .setStyle(pct === 100 ? ButtonStyle.Danger : ButtonStyle.Primary),
        );
    });

    return {
        embeds: [embed],
        components: [pctRow, new ActionRowBuilder().addComponents(backButton("cripto_vender", "◀ Volver"))],
    };
}

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
    const ttclP = getTtclPrecio(guildId);

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
    const cfg = guildSettings.getSettings(guildId).cripto;
    const basePrice = Math.max(0.0001, Number(cfg.ttcl_base_price || TTCL.precioInicial));
    const volatility = Math.max(0, Number(cfg.ttcl_volatility || TTCL.factorVolatilidad));
    const circ = ttclCirculacion();
    const precio = getTtclPrecio(guildId);
    const marketCap = circ * precio;
    const supplyPct = ((circ / TTCL.ofertaTotal) * 100).toFixed(2);

    const curve = [
        ["  0%", formatCoins(basePrice)],
        [" 10%", formatCoins(basePrice * Math.exp((0.1 * volatility) / 10))],
        [" 25%", formatCoins(basePrice * Math.exp((0.25 * volatility) / 10))],
        [" 50%", formatCoins(basePrice * Math.exp((0.5 * volatility) / 10))],
        [" 75%", formatCoins(basePrice * Math.exp((0.75 * volatility) / 10))],
        [" 90%", formatCoins(basePrice * Math.exp((0.9 * volatility) / 10))],
    ]
        .map(([s, p]) => `\`${s} supply → ${p.padStart(8)} 🪙\``)
        .join("\n");

    const embed = new EmbedBuilder()
        .setTitle("ℹ️ TTCL Coin — Tokenomics")
        .setDescription(
            `**Símbolo:** $TTCL\n` +
                `**Supply total:** ${TTCL.ofertaTotal.toLocaleString("es")}\n` +
                `**En circulación:** ${circ.toFixed(4)} · _${supplyPct}% del supply_\n` +
                `**Precio actual:** ${precio.toFixed(2)} 🪙\n` +
                `**Market Cap:** ${formatCoins(marketCap)} 🪙\n\n` +
                `**Modelo AMM (curva exponencial):**\n` +
                `\`precio = ${basePrice} × e^(circulación / 1M × ${volatility / 10})\`\n\n` +
                `**Tabla de precios aproximados:**\n${curve}`,
        )
        .setColor(0x9b59b6)
        .setTimestamp();

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton())],
    };
}

// ─── HELPER DE RESPUESTA ─────────────────────────────────────────────────────

async function safeUpdate(interaction, payload) {
    try {
        await interaction.update(payload);
    } catch (e) {
        logWarn("[Cripto] interaction.update falló: " + e.message);
        try {
            await interaction.editReply(payload);
        } catch (e2) {
            logWarn(`[Cripto] Tampoco se pudo editar la respuesta (${interaction.customId}): ${e2.message}`);
        }
    }
}

// ─── MÓDULO PRINCIPAL ─────────────────────────────────────────────────────────

module.exports = {
    componentHandlers: [{ types: ["button", "stringSelect"], prefixes: ["cripto_"], method: "handleInteraction", acl: "cripto" }],
    getTtclPrecio,
    data: new SlashCommandBuilder().setName("cripto").setDescription("📈 Panel de criptomonedas del servidor"),

    async run(client, interaction) {
        await interaction.deferReply();
        await interaction.editReply(await buildMainPanel(interaction.user.id, interaction.guildId));
    },

    async handleInteraction(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;

        // ── Panel principal
        if (id === "cripto_panel") {
            return safeUpdate(interaction, await buildMainPanel(userId, interaction.guildId));
        }

        // ── Precios
        if (id === "cripto_precios") {
            return safeUpdate(interaction, await buildPreciosPanel(interaction.guildId));
        }

        // ── Cartera + donut
        if (id === "cripto_cartera") {
            return safeUpdate(interaction, await buildCarteraPanel(userId, interaction.guildId));
        }

        // ── Comprar: selector de cripto
        if (id === "cripto_comprar") {
            return safeUpdate(interaction, buildComprarSelect());
        }

        // ── Comprar: seleccionó cripto, muestra importes
        if (id === "cripto_comprar_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await buildComprarCantidad(userId, sym, interaction.guildId));
        }

        // ── Comprar: ejecutar  (cripto_comprar_exec_SYM_MONEDAS)
        if (id.startsWith("cripto_comprar_exec_")) {
            const parts = id.split("_"); // ["cripto","comprar","exec","SYM","MONEDAS"]
            const monedas = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            const result = await ejecutarCompra(interaction.guildId, userId, sym, monedas);
            const ci = cryptoInfoBySymbol(sym);
            const embed = result.ok
                ? new EmbedBuilder()
                      .setTitle("✅ Compra realizada")
                      .setDescription(
                          `Compraste **${formatCryptoAmt(result.cantidad)} ${sym}** ${ci?.emoji || ""}\n` +
                              `Invertido: **${monedas.toLocaleString("es")} 🪙** @ ${formatCoins(result.precio)} 🪙/u` +
                              `${result.fee > 0 ? `\nComisión: **${result.fee.toLocaleString("es")} 🪙**` : ""}`,
                      )
                      .setColor(0x2ecc71)
                : new EmbedBuilder().setTitle("❌ Error").setDescription(result.msg).setColor(0xe74c3c);

            return safeUpdate(interaction, {
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(
                        backButton("cripto_panel", "🏠 Panel"),
                        backButton("cripto_comprar", "🛒 Seguir comprando"),
                    ),
                ],
                files: [],
            });
        }

        // ── Vender: selector de cripto
        if (id === "cripto_vender") {
            return safeUpdate(interaction, buildVenderSelect(userId));
        }

        // ── Vender: seleccionó cripto, muestra porcentajes
        if (id === "cripto_vender_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await buildVenderPct(userId, sym, interaction.guildId));
        }

        // ── Vender: ejecutar  (cripto_vender_exec_SYM_PCT)
        if (id.startsWith("cripto_vender_exec_")) {
            const parts = id.split("_"); // ["cripto","vender","exec","SYM","PCT"]
            const pct = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            const result = await ejecutarVenta(interaction.guildId, userId, sym, pct);
            const ci = cryptoInfoBySymbol(sym);
            const embed = result.ok
                ? new EmbedBuilder()
                      .setTitle("✅ Venta realizada")
                      .setDescription(
                          `Vendiste **${formatCryptoAmt(result.cantidad)} ${sym}** ${ci?.emoji || ""}\n` +
                              `Recibido: **${result.monedas.toLocaleString("es")} 🪙** @ ${formatCoins(result.precio)} 🪙/u`,
                      )
                      .setColor(0x2ecc71)
                : new EmbedBuilder().setTitle("❌ Error").setDescription(result.msg).setColor(0xe74c3c);

            return safeUpdate(interaction, {
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(
                        backButton("cripto_panel", "🏠 Panel"),
                        backButton("cripto_vender", "💸 Seguir vendiendo"),
                    ),
                ],
                files: [],
            });
        }

        // ── Gráfico: selector de cripto
        if (id === "cripto_grafico") {
            return safeUpdate(interaction, buildGraficoSelectPanel());
        }

        // ── Gráfico: seleccionó cripto → mostrar con 7d por defecto
        if (id === "cripto_grafico_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await buildGraficoChart(sym, 7, interaction.guildId));
        }

        // ── Gráfico: cambio de rango  (cripto_grafico_rng_SYM_DAYS)
        if (id.startsWith("cripto_grafico_rng_")) {
            const parts = id.split("_"); // ["cripto","grafico","rng","SYM","DAYS"]
            const days = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            return safeUpdate(interaction, await buildGraficoChart(sym, days, interaction.guildId));
        }

        // ── Top holders
        if (id === "cripto_top") {
            return safeUpdate(interaction, await buildTopHolders(interaction.guildId));
        }

        // ── Historial
        if (id === "cripto_historial") {
            return safeUpdate(interaction, buildHistorialPanel(userId));
        }

        // ── Info $TTCL
        if (id === "cripto_info") {
            return safeUpdate(interaction, buildInfoPanel(interaction.guildId));
        }
    },
};
