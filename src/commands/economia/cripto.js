// /cripto: un panel con pestañas (📈 Mercado, 🛒 Comprar, 💸 Vender, 💼 Cartera, 🧾 Historial). La lógica está en
// systems/cripto y las pantallas en paneles/cripto; aquí solo se reparte cada botón a su pantalla.
const { SlashCommandBuilder } = require("discord.js");
const { logWarn } = require("../../core/logger");
const mercado = require("../../systems/cripto/mercado");
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
    componentHandlers: [
        { types: ["button"], prefixes: ["cripto_"], method: "handleInteraction", acl: "cripto" },
        { types: ["modal"], prefixes: ["cripto_modal_"], method: "handleModal", acl: "cripto" },
    ],
    data: new SlashCommandBuilder().setName("cripto").setDescription("📈 Panel de criptomonedas del servidor"),

    async run(client, interaction) {
        await interaction.deferReply();
        await interaction.editReply(await paneles.pantallaMercado(interaction.guildId));
    },

    async handleInteraction(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // ── Pestañas
        if (id.startsWith("cripto_tab_")) {
            return safeUpdate(interaction, await paneles.pestana(id.replace("cripto_tab_", ""), userId, guildId));
        }

        // ── Mercado: rango de la gráfica (cripto_rango_DIAS)
        if (id.startsWith("cripto_rango_")) {
            return safeUpdate(interaction, await paneles.pantallaMercado(guildId, Number(id.replace("cripto_rango_", ""))));
        }

        // ── Comprar: otra cantidad (modal)
        if (id === "cripto_comprar_modal") {
            return interaction.showModal(paneles.modalCompra());
        }

        // ── Comprar: vista previa de la cantidad elegida (cripto_comprar_ver_MONEDAS)
        if (id.startsWith("cripto_comprar_ver_")) {
            return safeUpdate(interaction, paneles.pantallaConfirmarCompra(userId, guildId, Number(id.replace("cripto_comprar_ver_", ""))));
        }

        // ── Comprar: confirmada (cripto_comprar_ok_MONEDAS)
        if (id.startsWith("cripto_comprar_ok_")) {
            const monedas = Number(id.replace("cripto_comprar_ok_", ""));
            const r = await mercado.ejecutarCompra(guildId, userId, mercado.TTCL.simbolo, monedas);
            return safeUpdate(interaction, paneles.pantallaComprar(userId, guildId, paneles.avisoCompra(r)));
        }

        // ── Vender: vista previa del porcentaje elegido (cripto_vender_ver_PCT)
        if (id.startsWith("cripto_vender_ver_")) {
            return safeUpdate(interaction, paneles.pantallaConfirmarVenta(userId, guildId, Number(id.replace("cripto_vender_ver_", ""))));
        }

        // ── Vender: confirmada (cripto_vender_ok_PCT)
        if (id.startsWith("cripto_vender_ok_")) {
            const pct = Number(id.replace("cripto_vender_ok_", ""));
            const r = await mercado.ejecutarVenta(guildId, userId, mercado.TTCL.simbolo, pct);
            return safeUpdate(interaction, paneles.pantallaVender(userId, guildId, paneles.avisoVenta(r)));
        }

        // ── Historial: página (cripto_hist_PAGINA)
        if (id.startsWith("cripto_hist_")) {
            return safeUpdate(interaction, await paneles.pantallaHistorial(userId, Number(id.replace("cripto_hist_", ""))));
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId !== "cripto_modal_comprar") return;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const texto = interaction.fields.getTextInputValue("monedas").replace(/[\s.]/g, "");
        if (!/^\d+$/.test(texto)) {
            return safeUpdate(
                interaction,
                paneles.pantallaComprar(userId, guildId, "❌ Escribe un número entero de monedas, p. ej. 2500."),
            );
        }
        return safeUpdate(interaction, paneles.pantallaConfirmarCompra(userId, guildId, Number(texto)));
    },
};
