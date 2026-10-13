// Botones de dinero (dinero_*) de la pestaña 💰 Economía de /perfil: ingresar, sacar, transferir y
// movimientos. No es un comando (antes era /banco): el router registra sus botones igual (src/perfil).
// Atiende también "💵 Sacar del banco" desde el casino, la tienda y la cripto (dinero_sacar_{volver}): después
// de sacar, la pantalla de la que venías se vuelve a pintar con el efectivo nuevo.
const { MessageFlags } = require("discord.js");
const dinero = require("../systems/dinero");
const economia = require("../paneles/economia");
const { importeElegido } = require("../paneles/importes");
const prestamos = require("../systems/prestamos");
const negocios = require("../systems/negocios");
const tienda = require("../systems/tienda");
const guildSettings = require("../systems/guildSettings");
const panelCasino = require("../paneles/casino");
const panelTienda = require("../paneles/tienda");
const panelCripto = require("../paneles/cripto");
const panelNegocios = require("../paneles/negocios");
const { createLogger } = require("../core/logger");

const log = createLogger("Dinero");

const economiaPropia = (interaction, aviso = null) =>
    economia.buildEconomia({ viewerId: interaction.user.id, nombre: interaction.user.username, guildId: interaction.guildId, aviso });

// Pantallas a las que se vuelve después de "💵 Sacar del banco" (el customId del botón que las pinta).
async function repintar(volver, interaction) {
    const userId = interaction.user.id;
    if (volver.startsWith("casino_pick_ruleta_")) {
        const [tipo, valor] = volver.replace("casino_pick_ruleta_", "").split("_");
        return panelCasino.buildPickMontoRuleta(userId, tipo, valor);
    }
    if (volver.startsWith("casino_pick_")) return panelCasino.buildPickApuesta(userId, volver.replace("casino_pick_", ""));
    if (volver.startsWith("tienda_confirmar_")) {
        const item = tienda.itemTienda(parseInt(volver.replace("tienda_confirmar_", ""), 10));
        const cfg = guildSettings.getSettings(interaction.guildId).tienda;
        if (item) return panelTienda.buildConfirmacion(item, tienda.saldoDe(userId), cfg, userId);
    }
    if (volver.startsWith("cripto_")) return panelCripto.repintar(volver, userId, interaction.guildId);
    return economiaPropia(interaction);
}

async function devolverPrestamo(interaction) {
    const r = prestamos.devolver(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
    log.info(`${interaction.user.tag}: ${r.mensaje.replace(/\*/g, "")}`);
    return interaction.update(await economiaPropia(interaction, r.mensaje));
}

function abrirSacar(interaction) {
    const volver = interaction.customId.replace(/^dinero_sacar_?/, "");
    return interaction.showModal(
        economia.modalCantidad(
            `dinero_modal_sacar${volver ? `_${volver}` : ""}`,
            "💵 Sacar del banco",
            dinero.cuenta(interaction.user.id).banco,
        ),
    );
}

function movimientos(interaction) {
    const userId = interaction.user.id;
    const [tipo, pagina, targetId = userId] = interaction.customId.replace("dinero_mov_", "").split("_");
    return interaction.update(economia.buildMovimientos(userId, targetId, tipo, Math.max(0, parseInt(pagina, 10) || 0)));
}

// Los botones de dinero_*, en orden: el primero cuyo customId encaja se atiende. Cada caso llama a su caso de uso (systems/dinero,
// prestamos, negocios) o pinta su pantalla (paneles/economia, negocios); aquí no hay reglas (#476).
const RUTAS_BOTON = [
    ["dinero_panel", async (i) => i.update(await economiaPropia(i))],
    // 🧙 Devolver el préstamo del Duende (F-DU-03), todo lo que falta, del efectivo.
    ["dinero_prestamo_devolver", devolverPrestamo],
    ["dinero_transferir", async (i) => i.update(economia.buildElegirDestinatario(i.user.id))],
    // 🏪 Negocios (F-EC-06d): comprar, vender y depositar dinero negro para limpiarlo.
    ["dinero_negocios", async (i) => i.update(panelNegocios.buildNegocios(i.user.id))],
    [
        "dinero_negocio_depositar",
        async (i) =>
            i.showModal(economia.modalCantidad("dinero_modal_depositar_negocio", "🧼 Depositar dinero negro", dinero.negro(i.user.id))),
    ],
    [
        "dinero_ingresar",
        async (i) =>
            i.showModal(economia.modalCantidad("dinero_modal_ingresar", "🏦 Ingresar en el banco", dinero.cuenta(i.user.id).efectivo)),
    ],
    // dinero_sacar (desde Economía) o dinero_sacar_{volver} (desde otra pantalla).
    [(id) => id === "dinero_sacar" || id.startsWith("dinero_sacar_"), abrirSacar],
    // dinero_mov_{tipo}_{pagina}[_{de quién}] (sin "de quién", los tuyos: mensajes de antes).
    [(id) => id.startsWith("dinero_mov_"), movimientos],
].map(([encaja, manejador]) => [typeof encaja === "string" ? (id) => id === encaja : encaja, manejador]);

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["dinero_"], method: "handleButton", acl: "perfil" },
        { types: ["stringSelect"], prefixes: ["dinero_filtro_", "dinero_negocio_"], method: "handleSelect", acl: "perfil" },
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
        const ruta = RUTAS_BOTON.find(([encaja]) => encaja(interaction.customId));
        if (ruta) return ruta[1](interaction);
    },

    async handleSelect(client, interaction) {
        const userId = interaction.user.id;
        if (interaction.customId === "dinero_negocio_elegir") {
            const [accion, tipo] = interaction.values[0].split("_");
            const r = accion === "comprar" ? negocios.comprar(userId, interaction.guildId, tipo) : negocios.vender(userId, tipo);
            return interaction.update(panelNegocios.buildNegocios(userId, r.mensaje));
        }
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
        const cantidad = importeElegido(interaction.fields);
        let r;
        let volver = null;
        if (id === "dinero_modal_depositar_negocio") {
            const r2 = negocios.depositar(userId, interaction.guildId, cantidad);
            if (!r2.ok) return interaction.reply({ content: r2.mensaje, flags: MessageFlags.Ephemeral });
            const payload = panelNegocios.buildNegocios(userId, r2.mensaje);
            return interaction.isFromMessage?.()
                ? interaction.update(payload)
                : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
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
