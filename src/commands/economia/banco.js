// /banco: el panel 💰 Economía (efectivo y banco, ingresar, sacar, transferir, movimientos y más ricos).
// Sustituye a los subcomandos saldo/depositar/retirar/transferir/top/historial: todo se hace con botones.
// Atiende también "💵 Sacar del banco" desde el casino, la tienda y la cripto (dinero_sacar_{volver}): después
// de sacar, la pantalla de la que venías se vuelve a pintar con el efectivo nuevo.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const dinero = require("../../systems/dinero");
const economia = require("../../paneles/economia");
const { createLogger } = require("../../core/logger");

const log = createLogger("Banco");

// Pantallas a las que se vuelve después de "💵 Sacar del banco" (el customId del botón que las pinta).
async function repintar(volver, interaction) {
    const userId = interaction.user.id;
    if (volver.startsWith("casino_pick_ruleta_")) {
        const [tipo, valor] = volver.replace("casino_pick_ruleta_", "").split("_");
        return require("../../paneles/casino").buildPickMontoRuleta(userId, tipo, valor);
    }
    if (volver.startsWith("casino_pick_"))
        return require("../../paneles/casino").buildPickApuesta(userId, volver.replace("casino_pick_", ""));
    if (volver.startsWith("tienda_confirmar_")) {
        const tienda = require("../../systems/tienda");
        const item = tienda.itemTienda(parseInt(volver.replace("tienda_confirmar_", ""), 10));
        const cfg = require("../../systems/guildSettings").getSettings(interaction.guildId).tienda;
        if (item) return require("../../paneles/tienda").buildConfirmacion(item, tienda.saldoDe(userId), cfg, userId);
    }
    if (volver.startsWith("cripto_cant_")) {
        return require("../../paneles/cripto").buildComprarCantidad(userId, volver.replace("cripto_cant_", ""), interaction.guildId);
    }
    return economia.buildEconomia(userId, interaction.user.username);
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["dinero_"], method: "handleButton", acl: "banco" },
        { types: ["stringSelect", "userSelect"], ids: ["dinero_filtro", "dinero_transferir_a"], method: "handleSelect", acl: "banco" },
        { types: ["modal"], prefixes: ["dinero_modal_"], method: "handleModal", acl: "banco" },
    ],
    data: new SlashCommandBuilder()
        .setName("banco")
        .setDescription("Tu dinero: efectivo y banco, ingresar, sacar, transferir y movimientos"),

    async run(client, interaction) {
        require("../../systems/casinoTransactions").registrarUsuario(interaction.user.id, interaction.user.username, interaction.user.tag);
        await interaction.reply(economia.buildEconomia(interaction.user.id, interaction.user.username));
    },

    async handleButton(client, interaction) {
        // Solo quien abrió el panel (el casino, la tienda o la cripto de otro tampoco).
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
            return;
        }
        const id = interaction.customId;
        const userId = interaction.user.id;
        const c = dinero.cuenta(userId);

        if (id === "dinero_panel") return interaction.update(economia.buildEconomia(userId, interaction.user.username));
        if (id === "dinero_ricos") return interaction.update(economia.buildRicos());
        if (id === "dinero_transferir") return interaction.update(economia.buildElegirDestinatario());
        if (id === "dinero_ingresar")
            return interaction.showModal(economia.modalCantidad("dinero_modal_ingresar", "🏦 Ingresar en el banco", c.efectivo));
        // dinero_sacar (desde Economía) o dinero_sacar_{volver} (desde otra pantalla).
        if (id === "dinero_sacar" || id.startsWith("dinero_sacar_")) {
            const volver = id.replace(/^dinero_sacar_?/, "");
            return interaction.showModal(
                economia.modalCantidad(`dinero_modal_sacar${volver ? `_${volver}` : ""}`, "💵 Sacar del banco", c.banco),
            );
        }
        // dinero_mov_{tipo}_{pagina}
        if (id.startsWith("dinero_mov_")) {
            const [tipo, pagina] = id.replace("dinero_mov_", "").split("_");
            return interaction.update(economia.buildMovimientos(userId, tipo, Math.max(0, parseInt(pagina, 10) || 0)));
        }
    },

    async handleSelect(client, interaction) {
        const userId = interaction.user.id;
        if (interaction.customId === "dinero_filtro") {
            return interaction.update(economia.buildMovimientos(userId, interaction.values[0], 0));
        }
        if (interaction.customId === "dinero_transferir_a") {
            const destino = interaction.users?.first?.() || { id: interaction.values[0] };
            if (destino.bot) return interaction.reply({ content: "❌ No se puede transferir a un bot.", flags: MessageFlags.Ephemeral });
            if (destino.id === userId)
                return interaction.reply({ content: "❌ No puedes transferirte a ti mismo.", flags: MessageFlags.Ephemeral });
            return interaction.showModal(
                economia.modalCantidad(`dinero_modal_transferir_${destino.id}`, "💸 Transferir efectivo", dinero.efectivo(userId)),
            );
        }
    },

    async handleModal(client, interaction) {
        const userId = interaction.user.id;
        const id = interaction.customId;
        const cantidad = Number(String(interaction.fields.getTextInputValue("cantidad")).replace(/[.\s]/g, ""));
        let r;
        let volver = null;
        if (id === "dinero_modal_ingresar") r = dinero.ingresar(userId, cantidad);
        else if (id.startsWith("dinero_modal_sacar")) {
            r = dinero.sacar(userId, cantidad);
            volver = id.replace(/^dinero_modal_sacar_?/, "") || null;
        } else if (id.startsWith("dinero_modal_transferir_")) {
            const destinoId = id.replace("dinero_modal_transferir_", "");
            const destino = await interaction.client.users.fetch(destinoId).catch(() => null);
            r = dinero.transferir(userId, destinoId, cantidad, { de: interaction.user.username, a: destino?.username || destinoId });
        } else return;

        if (!r.ok) return interaction.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
        log.info(`${interaction.user.tag}: ${r.mensaje.replace(/\*/g, "")}`);
        // Se repinta la pantalla de la que venía el formulario: Economía, o la del casino/tienda/cripto.
        const payload = volver ? await repintar(volver, interaction) : economia.buildEconomia(userId, interaction.user.username, r.mensaje);
        if (interaction.isFromMessage?.()) {
            await interaction.update(payload);
            if (volver) await interaction.followUp({ content: r.mensaje, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
    },
};
