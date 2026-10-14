// Botones, menús y formularios mercado_* de /tienda: gestionar un objeto del inventario (🎁 regalar, 💰 vender a la tienda, 🏷️
// poner en el mercado), la pestaña 🏷️ Mercado, la ⭐ lista de deseos y 🎟️ canjear un código. No es un comando: el router registra
// sus rutas igual que las de dinero.js. Las reglas están en systems/ (objetosRegalo, tiendaRecompra, mercado, tiendaDeseos, codigos).
const { MessageFlags } = require("discord.js");
const panel = require("../paneles/tiendaExtras");
const panelTienda = require("../paneles/tienda");
const tienda = require("../systems/tienda");
const regalo = require("../systems/objetosRegalo");
const mercado = require("../systems/mercado");
const recompra = require("../systems/tiendaRecompra");
const deseos = require("../systems/tiendaDeseos");
const codigos = require("../systems/codigos");
const guildSettings = require("../systems/guildSettings");
const { simpleModal } = require("../adminPanel/common");
const { createLogger } = require("../core/logger");

const log = createLogger("Tienda");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const numero = (id, prefijo) => parseInt(id.slice(prefijo.length), 10);

/** El objeto del inventario (con sus datos) o null. */
const objetoDe = (userId, objetoId) => regalo.unidadDe(userId, objetoId) || null;

async function accionesDeObjeto(i, objetoId, aviso = null) {
    const obj = objetoDe(i.user.id, objetoId);
    if (!obj) return i.update(panel.buildElegirObjeto(i.user.id, "❌ Ya no tienes ese objeto."));
    return i.update(panel.buildAccionesObjeto(i.guildId, i.user.id, obj, aviso));
}

async function confirmarRegalo(i, id) {
    const [objetoId, destinoId] = id.slice("mercado_regalo_ok_".length).split("_");
    const obj = objetoDe(i.user.id, Number(objetoId));
    if (!obj) return i.update(panel.buildElegirObjeto(i.user.id, "❌ Ya no tienes ese objeto."));
    const destino = await i.guild.members.fetch(destinoId).catch(() => null);
    if (!destino) return accionesDeObjeto(i, obj.id, "❌ Esa persona no está en el servidor.");
    if (destino.user?.bot) return accionesDeObjeto(i, obj.id, "❌ No se puede regalar a un bot.");
    const r = regalo.regalar(i.user.id, destinoId, obj.id, { de: i.user.username, a: destino.user?.username || destinoId });
    if (r.ok) log.info(`${i.user.tag} regala "${obj.nombre}" a ${destinoId}`);
    return i.update(panel.buildElegirObjeto(i.user.id, r.mensaje));
}

async function confirmarVenta(i, objetoId) {
    const r = recompra.venderATienda(i.user.id, i.guildId, objetoId);
    if (r.ok) log.info(`${i.user.tag} vende el objeto #${objetoId} a la tienda por ${r.monedas}`);
    return i.update(panel.buildElegirObjeto(i.user.id, r.mensaje));
}

async function pedirVenta(i, objetoId) {
    const obj = objetoDe(i.user.id, objetoId);
    const monedas = obj ? recompra.precioDeRecompra(i.guildId, objetoId) : null;
    if (monedas === null) return accionesDeObjeto(i, objetoId, "❌ La tienda no recompra este objeto.");
    return i.update(panel.buildConfirmarVenta(obj, monedas));
}

async function alternarDeseo(i, tiendaId) {
    const r = deseos.alternar(i.user.id, tiendaId);
    if (!r.ok) return i.reply(privado(r.mensaje));
    const item = tienda.itemTienda(tiendaId);
    const cfg = guildSettings.getSettings(i.guildId).tienda;
    return i.update(panelTienda.buildConfirmacion(item, tienda.saldoDe(i.user.id), cfg, i.user.id));
}

async function comprarOferta(i, ofertaId) {
    const r = mercado.comprar(i.user.id, ofertaId, { comprador: i.user.username });
    if (r.ok) log.info(`${i.user.tag} compra en el mercado "${r.oferta.nombre}" por ${r.oferta.precio}`);
    return i.update(panel.buildMercado(i.user.id, 1, r.mensaje));
}

async function pedirPrecio(i, objetoId) {
    const obj = objetoDe(i.user.id, objetoId);
    if (!obj) return i.update(panel.buildElegirObjeto(i.user.id, "❌ Ya no tienes ese objeto."));
    return i.showModal(
        simpleModal(`mercado_modal_precio_${objetoId}`, `Vender ${obj.nombre}`.slice(0, 45), [
            { id: "precio", label: "Precio en monedas", placeholder: "500" },
        ]),
    );
}

// Los botones, en orden: el primero que encaja con el id se atiende.
const BOTONES = [
    [(id) => id === "mercado_gestionar", (i) => i.update(panel.buildElegirObjeto(i.user.id))],
    [
        (id) => id.startsWith("mercado_regalar_"),
        (i, id) => {
            const obj = objetoDe(i.user.id, numero(id, "mercado_regalar_"));
            return obj
                ? i.update(panel.buildElegirDestinatario(obj))
                : i.update(panel.buildElegirObjeto(i.user.id, "❌ Ya no tienes ese objeto."));
        },
    ],
    [(id) => id.startsWith("mercado_regalo_ok_"), confirmarRegalo],
    [(id) => id.startsWith("mercado_vender_ok_"), (i, id) => confirmarVenta(i, numero(id, "mercado_vender_ok_"))],
    [(id) => id.startsWith("mercado_vender_"), (i, id) => pedirVenta(i, numero(id, "mercado_vender_"))],
    [(id) => id.startsWith("mercado_poner_"), (i, id) => pedirPrecio(i, numero(id, "mercado_poner_"))],
    [(id) => id.startsWith("mercado_ver_"), (i, id) => i.update(panel.buildMercado(i.user.id, numero(id, "mercado_ver_")))],
    [(id) => id === "mercado_mias", (i) => i.update(panel.buildMisOfertas(i.user.id))],
    [(id) => id.startsWith("mercado_comprar_"), (i, id) => comprarOferta(i, numero(id, "mercado_comprar_"))],
    [(id) => id === "mercado_deseos", (i) => i.update(panel.buildDeseos(i.user.id))],
    [(id) => id.startsWith("mercado_deseo_"), (i, id) => alternarDeseo(i, numero(id, "mercado_deseo_"))],
    [
        (id) => id === "mercado_canjear",
        (i) =>
            i.showModal(
                simpleModal("mercado_modal_canjear", "🎟️ Canjear un código", [
                    { id: "codigo", label: "Código", placeholder: "BIENVENIDA" },
                ]),
            ),
    ],
];

async function guardarPrecio(i) {
    const objetoId = numero(i.customId, "mercado_modal_precio_");
    const precio = Number(i.fields.getTextInputValue("precio").replace(/[\s.,]/g, ""));
    const r = mercado.poner(i.user.id, objetoId, precio);
    if (r.ok) log.info(`${i.user.tag} pone "${r.oferta.nombre}" en el mercado por ${precio}`);
    return i.reply({ ...panel.buildElegirObjeto(i.user.id, r.mensaje), flags: MessageFlags.Ephemeral });
}

async function canjear(i) {
    const r = codigos.canjear(i.user.id, i.fields.getTextInputValue("codigo"));
    if (r.ok) log.info(`${i.user.tag} canjea un código`);
    return i.reply(privado(r.mensaje));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["mercado_"], method: "handleButton", acl: "tienda" },
        { types: ["stringSelect"], prefixes: ["mercado_"], method: "handleSelect", acl: "tienda" },
        { types: ["userSelect"], prefixes: ["mercado_regalo_a_"], method: "handleUserSelect", acl: "tienda" },
        { types: ["modal"], prefixes: ["mercado_modal_"], method: "handleModal", acl: "tienda" },
    ],

    async handleButton(client, interaction) {
        // Solo quien abrió la tienda.
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id)
            return interaction.reply(privado("⛔ Solo quien abrió la tienda puede usar estos botones."));
        const id = interaction.customId;
        const ruta = BOTONES.find(([encaja]) => encaja(id));
        if (ruta) return ruta[1](interaction, id);
    },

    async handleSelect(client, interaction) {
        const id = interaction.customId;
        const valor = interaction.values[0];
        if (id === "mercado_gestion_sel") return accionesDeObjeto(interaction, Number(valor));
        if (id === "mercado_retirar_sel") {
            const r = mercado.retirar(interaction.user.id, Number(valor));
            return interaction.update(panel.buildMisOfertas(interaction.user.id, r.mensaje));
        }
        if (id === "mercado_deseo_quitar_sel") {
            deseos.alternar(interaction.user.id, Number(valor));
            return interaction.update(panel.buildDeseos(interaction.user.id));
        }
    },

    async handleUserSelect(client, interaction) {
        const objetoId = numero(interaction.customId, "mercado_regalo_a_");
        const destino = interaction.users?.first?.() || { id: interaction.values[0] };
        const obj = objetoDe(interaction.user.id, objetoId);
        if (!obj) return interaction.update(panel.buildElegirObjeto(interaction.user.id, "❌ Ya no tienes ese objeto."));
        if (destino.bot) return interaction.reply(privado("❌ No se puede regalar a un bot."));
        if (destino.id === interaction.user.id) return interaction.reply(privado("❌ No puedes regalarte un objeto a ti mismo."));
        return interaction.update(panel.buildConfirmarRegalo(obj, destino.id));
    },

    async handleModal(client, interaction) {
        const id = interaction.customId;
        if (id.startsWith("mercado_modal_precio_")) return guardarPrecio(interaction);
        if (id === "mercado_modal_canjear") return canjear(interaction);
    },
};
