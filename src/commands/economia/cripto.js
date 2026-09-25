// /cripto: un panel con botones. La lógica (precios, compra/venta) está en systems/cripto y los
// paneles en paneles/cripto; aquí solo se reparte cada botón a su panel.
const { SlashCommandBuilder } = require("discord.js");
const { logWarn } = require("../../core/logger");
const { getTtclPrecio, ejecutarCompra, ejecutarVenta } = require("../../systems/cripto/mercado");
const paneles = require("../../paneles/cripto");

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
        await interaction.editReply(await paneles.buildMainPanel(interaction.user.id, interaction.guildId));
    },

    async handleInteraction(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;

        // ── Panel principal
        if (id === "cripto_panel") {
            return safeUpdate(interaction, await paneles.buildMainPanel(userId, interaction.guildId));
        }

        // ── Precios
        if (id === "cripto_precios") {
            return safeUpdate(interaction, await paneles.buildPreciosPanel(interaction.guildId));
        }

        // ── Cartera + donut
        if (id === "cripto_cartera") {
            return safeUpdate(interaction, await paneles.buildCarteraPanel(userId, interaction.guildId));
        }

        // ── Comprar: selector de cripto
        if (id === "cripto_comprar") {
            return safeUpdate(interaction, paneles.buildComprarSelect());
        }

        // ── Comprar: seleccionó cripto, muestra importes
        if (id === "cripto_comprar_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await paneles.buildComprarCantidad(userId, sym, interaction.guildId));
        }

        // ── Comprar: ejecutar  (cripto_comprar_exec_SYM_MONEDAS)
        if (id.startsWith("cripto_comprar_exec_")) {
            const parts = id.split("_"); // ["cripto","comprar","exec","SYM","MONEDAS"]
            const monedas = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            const result = await ejecutarCompra(interaction.guildId, userId, sym, monedas);
            return safeUpdate(interaction, paneles.buildResultadoCompra(sym, monedas, result));
        }

        // ── Vender: selector de cripto
        if (id === "cripto_vender") {
            return safeUpdate(interaction, paneles.buildVenderSelect(userId));
        }

        // ── Vender: seleccionó cripto, muestra porcentajes
        if (id === "cripto_vender_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await paneles.buildVenderPct(userId, sym, interaction.guildId));
        }

        // ── Vender: ejecutar  (cripto_vender_exec_SYM_PCT)
        if (id.startsWith("cripto_vender_exec_")) {
            const parts = id.split("_"); // ["cripto","vender","exec","SYM","PCT"]
            const pct = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            const result = await ejecutarVenta(interaction.guildId, userId, sym, pct);
            return safeUpdate(interaction, paneles.buildResultadoVenta(sym, result));
        }

        // ── Gráfico: selector de cripto
        if (id === "cripto_grafico") {
            return safeUpdate(interaction, paneles.buildGraficoSelectPanel());
        }

        // ── Gráfico: seleccionó cripto → mostrar con 7d por defecto
        if (id === "cripto_grafico_sel" && interaction.isStringSelectMenu()) {
            const sym = interaction.values[0];
            return safeUpdate(interaction, await paneles.buildGraficoChart(sym, 7, interaction.guildId));
        }

        // ── Gráfico: cambio de rango  (cripto_grafico_rng_SYM_DAYS)
        if (id.startsWith("cripto_grafico_rng_")) {
            const parts = id.split("_"); // ["cripto","grafico","rng","SYM","DAYS"]
            const days = parseInt(parts[parts.length - 1], 10);
            const sym = parts.slice(3, parts.length - 1).join("_");
            return safeUpdate(interaction, await paneles.buildGraficoChart(sym, days, interaction.guildId));
        }

        // ── Top holders
        if (id === "cripto_top") {
            return safeUpdate(interaction, await paneles.buildTopHolders(interaction.guildId));
        }

        // ── Historial
        if (id === "cripto_historial") {
            return safeUpdate(interaction, paneles.buildHistorialPanel(userId));
        }

        // ── Info $TTCL
        if (id === "cripto_info") {
            return safeUpdate(interaction, paneles.buildInfoPanel(interaction.guildId));
        }
    },
};
