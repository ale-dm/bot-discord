// Botones de dinero (dinero_*) de la pestaña 💰 Economía de /perfil: ingresar, sacar, transferir y
// movimientos. No es un comando (antes era /banco): el router registra sus botones igual (src/perfil).
// Atiende también "💵 Sacar del banco" desde el casino, la tienda y la cripto (dinero_sacar_{volver}): después
// de sacar, la pantalla de la que venías se vuelve a pintar con el efectivo nuevo.
const { MessageFlags } = require("discord.js");
const dinero = require("../systems/dinero");
const economia = require("../paneles/economia");
const { createLogger } = require("../core/logger");

const log = createLogger("Dinero");

const economiaPropia = (interaction, aviso = null) =>
    economia.buildEconomia({ viewerId: interaction.user.id, nombre: interaction.user.username, guildId: interaction.guildId, aviso });

// Pantallas a las que se vuelve después de "💵 Sacar del banco" (el customId del botón que las pinta).
async function repintar(volver, interaction) {
    const userId = interaction.user.id;
    if (volver.startsWith("casino_pick_ruleta_")) {
        const [tipo, valor] = volver.replace("casino_pick_ruleta_", "").split("_");
        return require("../paneles/casino").buildPickMontoRuleta(userId, tipo, valor);
    }
    if (volver.startsWith("casino_pick_")) return require("../paneles/casino").buildPickApuesta(userId, volver.replace("casino_pick_", ""));
    if (volver.startsWith("tienda_confirmar_")) {
        const tienda = require("../systems/tienda");
        const item = tienda.itemTienda(parseInt(volver.replace("tienda_confirmar_", ""), 10));
        const cfg = require("../systems/guildSettings").getSettings(interaction.guildId).tienda;
        if (item) return require("../paneles/tienda").buildConfirmacion(item, tienda.saldoDe(userId), cfg, userId);
    }
    if (volver.startsWith("cripto_cant_")) {
        return require("../paneles/cripto").buildComprarCantidad(userId, volver.replace("cripto_cant_", ""), interaction.guildId);
    }
    return economiaPropia(interaction);
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["dinero_"], method: "handleButton", acl: "perfil" },
        { types: ["stringSelect"], prefixes: ["dinero_filtro_"], method: "handleSelect", acl: "perfil" },
        { types: ["userSelect"], ids: ["dinero_transferir_a"], method: "handleSelect", acl: "perfil" },
        { types: ["modal"], prefixes: ["dinero_modal_"], method: "handleModal", acl: "perfil" },
    ],

    async handleButton(client, interaction) {
        // Solo quien abrió el panel (el perfil, el casino, la tienda o la cripto de otro tampoco).
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id) {
            await interaction.reply({ content: "⛔ Solo quien abrió el panel puede usar estos botones.", flags: MessageFlags.Ephemeral });
            return;
        }
        const id = interaction.customId;
        const userId = interaction.user.id;
        const c = dinero.cuenta(userId);

        if (id === "dinero_panel") return interaction.update(await economiaPropia(interaction));
        if (id === "dinero_diario") {
            const r = require("../systems/diario").cobrar(interaction.guildId, userId);
            if (!r.ok) return interaction.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
            return interaction.update(await economiaPropia(interaction, r.mensaje));
        }
        if (id === "dinero_transferir") return interaction.update(economia.buildElegirDestinatario(userId));
        if (id === "dinero_ingresar")
            return interaction.showModal(economia.modalCantidad("dinero_modal_ingresar", "🏦 Ingresar en el banco", c.efectivo));
        // dinero_sacar (desde Economía) o dinero_sacar_{volver} (desde otra pantalla).
        if (id === "dinero_sacar" || id.startsWith("dinero_sacar_")) {
            const volver = id.replace(/^dinero_sacar_?/, "");
            return interaction.showModal(
                economia.modalCantidad(`dinero_modal_sacar${volver ? `_${volver}` : ""}`, "💵 Sacar del banco", c.banco),
            );
        }
        // dinero_mov_{tipo}_{pagina}[_{de quién}] (sin "de quién", los tuyos: mensajes de antes).
        if (id.startsWith("dinero_mov_")) {
            const [tipo, pagina, targetId = userId] = id.replace("dinero_mov_", "").split("_");
            return interaction.update(economia.buildMovimientos(userId, targetId, tipo, Math.max(0, parseInt(pagina, 10) || 0)));
        }
    },

    async handleSelect(client, interaction) {
        const userId = interaction.user.id;
        // dinero_filtro_{de quién}
        if (interaction.customId.startsWith("dinero_filtro_")) {
            const targetId = interaction.customId.replace("dinero_filtro_", "") || userId;
            return interaction.update(economia.buildMovimientos(userId, targetId, interaction.values[0], 0));
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
        const payload = volver ? await repintar(volver, interaction) : await economiaPropia(interaction, r.mensaje);
        if (interaction.isFromMessage?.()) {
            await interaction.update(payload);
            if (volver) await interaction.followUp({ content: r.mensaje, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
    },
};
