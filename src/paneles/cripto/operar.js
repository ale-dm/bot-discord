// Paneles de /cripto para comprar y vender: elegir cripto, elegir importe/porcentaje y el resultado.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../../systems/guildSettings");
const {
    COINS_PER_EUR,
    getTtclPrecio,
    fetchGeckoPrices,
    formatCoins,
    formatCryptoAmt,
    getUserSaldo,
    getUserCarteras,
    cryptoInfoBySymbol,
} = require("../../systems/cripto/mercado");
const { backButton } = require("./comun");
const { botonSacar } = require("../economia");
const dinero = require("../../systems/dinero");

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
        priceCoins = getTtclPrecio();
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
                        `❌ No te llega el efectivo. Tienes **${saldo} 🪙** y el mínimo de inversión es ${minBuy.toLocaleString("es")} 🪙.`,
                    )
                    .setColor(0xe74c3c),
            ],
            components: [filaVolverCompra(userId, sym)],
        };
    }

    const embed = new EmbedBuilder()
        .setTitle(`🛒 Comprar ${ci?.emoji || "💰"} ${sym}`)
        .setDescription(
            `**Precio actual:** ${formatCoins(priceCoins)} 🪙 / unidad\n` +
                `**Tu efectivo:** ${saldo.toLocaleString("es")} 🪙\n\n` +
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
        components: [amtRow, filaVolverCompra(userId, sym)],
    };
}

// ◀ Volver y, si hay algo en el banco, 💵 Sacar del banco (vuelve a esta pantalla).
function filaVolverCompra(userId, sym) {
    const fila = new ActionRowBuilder().addComponents(backButton("cripto_comprar", "◀ Volver"));
    if (dinero.banco(userId) > 0) fila.addComponents(botonSacar(`cripto_cant_${sym}`));
    return fila;
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
        priceCoins = getTtclPrecio();
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

// ─── RESULTADO DE COMPRA / VENTA ─────────────────────────────────────────────

function buildResultadoCompra(sym, monedas, result) {
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
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                backButton("cripto_panel", "🏠 Panel"),
                backButton("cripto_comprar", "🛒 Seguir comprando"),
            ),
        ],
        files: [],
    };
}

function buildResultadoVenta(sym, result) {
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
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                backButton("cripto_panel", "🏠 Panel"),
                backButton("cripto_vender", "💸 Seguir vendiendo"),
            ),
        ],
        files: [],
    };
}

module.exports = { buildComprarSelect, buildComprarCantidad, buildVenderSelect, buildVenderPct, buildResultadoCompra, buildResultadoVenta };
