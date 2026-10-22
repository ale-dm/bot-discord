// Botones de dinero (dinero_*) de la pestaña 💰 Economía de /perfil: ingresar, sacar, transferir y
// movimientos. No es un comando (antes era /banco): el router registra sus botones igual (src/perfil).
// Atiende también "💵 Sacar del banco" desde el casino, la tienda y la cripto (dinero_sacar_{volver}): después
// de sacar, la pantalla de la que venías se vuelve a pintar con el efectivo nuevo.
const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { csvDeMovimientos, TOPE_FILAS } = require("../systems/movimientosCsv");
const dinero = require("../systems/dinero");
const economia = require("../paneles/economia");
const { importeElegido } = require("../paneles/importes");
const prestamos = require("../systems/prestamos");
const privacidad = require("../systems/privacidadEconomia");
const negocios = require("../systems/negocios");
const tienda = require("../systems/tienda");
const guildSettings = require("../systems/guildSettings");
const panelCasino = require("../paneles/casino");
const panelTienda = require("../paneles/tienda");
const panelCripto = require("../paneles/cripto");
const panelNegocios = require("../paneles/negocios");
const panelSeguro = require("../paneles/seguroAntirrobo");
const seguroAntirrobo = require("../systems/seguroAntirrobo");
const panelLimite = require("../paneles/limitePerdidas");
const limitePerdidas = require("../systems/limitePerdidas");
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
    // Los movimientos de quien ha ocultado su economía no se enseñan a los demás (#377).
    if (!privacidad.puedeVer(userId, targetId)) {
        return interaction.reply({ content: "🙈 Esa persona ha ocultado su economía.", flags: MessageFlags.Ephemeral });
    }
    return interaction.update(economia.buildMovimientos(userId, targetId, tipo, Math.max(0, parseInt(pagina, 10) || 0)));
}

// 🙈 Ocultar (1) o enseñar (0) tu economía a los demás (#377).
function ocultarEconomia(interaction) {
    privacidad.fijar(interaction.user.id, interaction.customId === "dinero_privada_1");
    return interaction.update(economiaPropia(interaction));
}

// 📤 Exporta tus movimientos (con el filtro activo) a un CSV que solo ves tú (#411).
function exportarMovimientos(interaction) {
    const tipo = interaction.customId.replace("dinero_exportar_", "");
    const { csv, filas, truncado } = csvDeMovimientos(interaction.user.id, tipo === "todo" ? null : tipo);
    const aviso = truncado ? ` Solo se exportan los ${TOPE_FILAS.toLocaleString("es")} más recientes.` : "";
    return interaction.reply({
        content: `📤 ${filas.toLocaleString("es")} movimientos.${aviso}`,
        files: [new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: "movimientos.csv" })],
        flags: MessageFlags.Ephemeral,
    });
}

// 🛡️ Límite de pérdidas (#319): quitarlo no es inmediato, así que se avisa de cuándo (la pantalla enseña lo pendiente).
function quitarLimite(interaction) {
    const r = limitePerdidas.quitar(interaction.user.id);
    return interaction.update(
        panelLimite.buildLimite(interaction.user.id, r.ok ? "⏳ El límite se quitará dentro de 24 horas." : `❌ ${r.motivo}`),
    );
}

// El formulario del límite: se guarda y se repinta la pantalla con lo que ha pasado.
async function guardarLimite(interaction) {
    const userId = interaction.user.id;
    const limite = interaction.fields
        .getTextInputValue("limite")
        .trim()
        .replace(/[\s.,]/g, "");
    const periodo = interaction.fields.getRadioGroup("periodo");
    const r = limitePerdidas.fijar(userId, limite, periodo);
    const aviso = r.ok ? panelLimite.avisoDeFijar(r, Number(limite), periodo) : `❌ ${r.motivo}`;
    if (r.ok)
        log.info(`${interaction.user.tag} puso su límite de pérdidas: ${limite} por ${periodo}${r.inmediato ? "" : " (pendiente 24 h)"}`);
    const payload = panelLimite.buildLimite(userId, aviso);
    return interaction.isFromMessage?.() ? interaction.update(payload) : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

// 🛡️ Seguro antirrobo (#526): comprar o renovar y repintar la pantalla con el resultado.
function comprarSeguro(interaction) {
    const r = seguroAntirrobo.comprar(interaction.user.id, interaction.guildId);
    let aviso;
    if (r.ok) {
        const hasta = Math.floor(r.vencimiento / 1000);
        aviso = `${r.extendido ? "🔁 Seguro renovado" : "✅ Seguro activo"} hasta <t:${hasta}:f>: te ha costado **${r.precio.toLocaleString("es")}** 🪙.`;
        log.info(`${interaction.user.tag}: ${r.extendido ? "renovó" : "compró"} el seguro antirrobo (${r.precio})`);
    } else if (r.motivo === "cooldown") {
        aviso = `⏳ Acabas de comprarlo. Podrás renovarlo dentro de ${Math.ceil(r.retrySeconds / 60)} min.`;
    } else if (r.motivo === "tope") {
        aviso = `🛡️ Ya tienes el máximo de seguro por delante (${Math.floor(r.restanteMs / seguroAntirrobo.DIA_MS)} días).`;
    } else {
        aviso = `❌ No te llega el dinero gastable para la prima de **${r.cfg.precio.toLocaleString("es")}** 🪙.`;
    }
    return interaction.update(panelSeguro.buildSeguro(interaction.user.id, interaction.guildId, aviso));
}

// Los botones de dinero_*, en orden: el primero cuyo customId encaja se atiende. Cada caso llama a su caso de uso (systems/dinero,
// prestamos, negocios) o pinta su pantalla (paneles/economia, negocios); aquí no hay reglas (#476).
const RUTAS_BOTON = [
    ["dinero_panel", async (i) => i.update(await economiaPropia(i))],
    // 🛡️ Seguro antirrobo (#526).
    ["dinero_seguro", async (i) => i.update(panelSeguro.buildSeguro(i.user.id, i.guildId))],
    ["dinero_seguro_comprar", comprarSeguro],
    // 🧙 Devolver el préstamo del Duende (F-DU-03), todo lo que falta, del efectivo.
    ["dinero_prestamo_devolver", devolverPrestamo],
    ["dinero_transferir", async (i) => i.update(economia.buildElegirDestinatario(i.user.id))],
    // 🛡️ Límite de pérdidas personal (#319).
    ["dinero_limite", async (i) => i.update(panelLimite.buildLimite(i.user.id))],
    ["dinero_limite_editar", async (i) => i.showModal(panelLimite.modalLimite(i.user.id))],
    ["dinero_limite_quitar", quitarLimite],
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
    [(id) => id.startsWith("dinero_exportar_"), exportarMovimientos],
    [(id) => id === "dinero_privada_0" || id === "dinero_privada_1", ocultarEconomia],
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
            const r =
                accion === "comprar"
                    ? negocios.comprar(userId, interaction.guildId, tipo)
                    : accion === "mejorar"
                      ? negocios.mejorar(userId, tipo)
                      : negocios.vender(userId, tipo);
            return interaction.update(panelNegocios.buildNegocios(userId, r.mensaje));
        }
        // dinero_filtro_{de quién}
        if (interaction.customId.startsWith("dinero_filtro_")) {
            const targetId = interaction.customId.replace("dinero_filtro_", "") || userId;
            if (!privacidad.puedeVer(userId, targetId)) {
                return interaction.reply({ content: "🙈 Esa persona ha ocultado su economía.", flags: MessageFlags.Ephemeral });
            }
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
        if (id === "dinero_modal_limite") return guardarLimite(interaction);
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
