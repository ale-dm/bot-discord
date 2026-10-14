// Pantallas extra de /tienda: gestionar un objeto del inventario (🎁 regalar, 💰 vender a la tienda, 🏷️ poner en el mercado),
// la pestaña 🏷️ Mercado entre jugadores y la ⭐ lista de deseos. Solo construyen embeds y botones; las reglas están en
// systems/objetosRegalo, tiendaRecompra, mercado y tiendaDeseos, y los botones (mercado_*) los atiende src/perfil/tiendaExtras.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
} = require("discord.js");
const objetos = require("../systems/objetos");
const mercado = require("../systems/mercado");
const recompra = require("../systems/tiendaRecompra");
const deseos = require("../systems/tiendaDeseos");
const { fmtNumero } = require("../core/formato");
const { filaPestanasTienda } = require("./tienda");
const { paginaDeLista } = require("./menuPaginado");

const POR_PAGINA_MERCADO = 4;
const fila = (...componentes) => new ActionRowBuilder().addComponents(...componentes);
const boton = (id, label, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(estilo);
const volverInventario = () => boton("tienda_inv_1", "◀ Inventario");

/** 🎁 Elegir qué objeto del inventario gestionar (hasta 25 distintos). */
function buildElegirObjeto(userId, aviso = null) {
    const { items: lista, total } = paginaDeLista(objetos.inventarioDe(userId));
    const embed = new EmbedBuilder()
        .setTitle("🎁 Gestionar un objeto")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lista.length
                    ? `Elige un objeto para regalarlo, venderlo a la tienda o ponerlo en el mercado.${total > lista.length ? ` (Salen los ${lista.length} más recientes de ${total}.)` : ""}`
                    : "No tienes objetos."),
        )
        .setColor(0x9b59b6);
    const filas = [];
    if (lista.length) {
        filas.push(
            fila(
                new StringSelectMenuBuilder()
                    .setCustomId("mercado_gestion_sel")
                    .setPlaceholder("Elige un objeto")
                    .addOptions(lista.map((o) => ({ label: `${o.cantidad}x ${o.nombre}`.slice(0, 100), value: String(o.id) }))),
            ),
        );
    }
    filas.push(fila(volverInventario()));
    return { content: "", embeds: [embed], components: filas };
}

/** Lo que se puede hacer con un objeto concreto. */
function buildAccionesObjeto(guildId, userId, objeto, aviso = null) {
    const monedas = recompra.precioDeRecompra(guildId, objeto.id);
    const embed = new EmbedBuilder()
        .setTitle(`🎁 ${objeto.nombre}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `${objeto.descripcion || "Sin descripción"}\n\n` +
                `🎁 **Regalar**: pasa a otra persona, sin cobrar.\n` +
                `💰 **Vender a la tienda**: ${monedas === null ? "no disponible (no está a la venta o la tienda no recompra)" : `**${fmtNumero(monedas)}** 🪙`}.\n` +
                "🏷️ **Mercado**: lo pones a un precio y lo compra otra persona (caduca a los 7 días).",
        )
        .setColor(0x9b59b6);
    return {
        content: "",
        embeds: [embed],
        components: [
            fila(
                boton(`mercado_regalar_${objeto.id}`, "🎁 Regalar", ButtonStyle.Primary),
                boton(`mercado_vender_${objeto.id}`, "💰 Vender a la tienda").setDisabled(monedas === null),
                boton(`mercado_poner_${objeto.id}`, "🏷️ Poner en el mercado"),
                boton("mercado_gestionar", "◀ Otro objeto"),
            ),
        ],
    };
}

function buildElegirDestinatario(objeto) {
    const embed = new EmbedBuilder().setTitle(`🎁 Regalar ${objeto.nombre}`).setDescription("¿A quién se lo regalas?").setColor(0x9b59b6);
    return {
        content: "",
        embeds: [embed],
        components: [
            fila(
                new UserSelectMenuBuilder()
                    .setCustomId(`mercado_regalo_a_${objeto.id}`)
                    .setPlaceholder("Elige a una persona")
                    .setMaxValues(1),
            ),
            fila(boton("mercado_gestionar", "Cancelar")),
        ],
    };
}

function buildConfirmarRegalo(objeto, destinoId) {
    const embed = new EmbedBuilder()
        .setTitle("¿Confirmar regalo?")
        .setDescription(`Vas a regalar **${objeto.nombre}** a <@${destinoId}>. No se paga nada y no se puede deshacer.`)
        .setColor(0xf39c12);
    return {
        content: "",
        embeds: [embed],
        components: [
            fila(
                boton(`mercado_regalo_ok_${objeto.id}_${destinoId}`, "✅ Regalar", ButtonStyle.Success),
                boton("mercado_gestionar", "Cancelar"),
            ),
        ],
    };
}

function buildConfirmarVenta(objeto, monedas) {
    const embed = new EmbedBuilder()
        .setTitle("¿Vender a la tienda?")
        .setDescription(`Vendes una unidad de **${objeto.nombre}** por **${fmtNumero(monedas)}** 🪙 al efectivo.`)
        .setColor(0xf39c12);
    return {
        content: "",
        embeds: [embed],
        components: [
            fila(boton(`mercado_vender_ok_${objeto.id}`, "✅ Vender", ButtonStyle.Success), boton("mercado_gestionar", "Cancelar")),
        ],
    };
}

/** Pestaña 🏷️ Mercado: las ofertas de todos, con un botón de compra por cada una. */
function buildMercado(userId, pagina = 1, aviso = null) {
    const { total, filas, paginas } = mercado.listar({ pagina, porPagina: POR_PAGINA_MERCADO });
    pagina = Math.min(Math.max(1, pagina), paginas);
    const embed = new EmbedBuilder()
        .setTitle("🏷️ Mercado")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (filas.length
                    ? "Objetos que otros jugadores venden a precio fijo. Se pagan con tu 💵 efectivo."
                    : "No hay nada a la venta ahora mismo. Pon algo desde 🎒 Inventario → 🎁 Gestionar."),
        )
        .setColor(0x1abc9c)
        .setFooter({ text: `Página ${pagina} de ${paginas} · ${total} ofertas` });
    for (const o of filas) {
        embed.addFields({
            name: `${o.nombre} — ${fmtNumero(o.precio)} 🪙`.slice(0, 256),
            value: `${(o.descripcion || "Sin descripción").slice(0, 200)}\nVendedor: <@${o.vendedor}> · caduca <t:${Math.floor(o.caduca / 1000)}:R>`,
        });
    }
    const filasUi = [];
    if (filas.length) {
        filasUi.push(
            fila(
                ...filas.map((o) =>
                    boton(
                        `mercado_comprar_${o.id}`,
                        `🛒 ${o.nombre} · ${fmtNumero(o.precio)}`.slice(0, 80),
                        ButtonStyle.Primary,
                    ).setDisabled(o.vendedor === String(userId)),
                ),
            ),
        );
    }
    filasUi.push(
        fila(
            boton(`mercado_ver_${pagina - 1}`, "◀").setDisabled(pagina <= 1),
            boton(`mercado_ver_${pagina + 1}`, "▶").setDisabled(pagina >= paginas),
            boton("mercado_mias", "📋 Mis ofertas"),
        ),
        filaPestanasTienda("mercado"),
    );
    return { content: "", embeds: [embed], components: filasUi };
}

/** Mis ofertas del mercado, con un menú para retirar una. */
function buildMisOfertas(userId, aviso = null) {
    const { filas } = mercado.listar({ porPagina: mercado.MAX_OFERTAS, vendedor: userId });
    const embed = new EmbedBuilder()
        .setTitle("📋 Mis ofertas")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (filas.length
                    ? filas
                          .map((o) => `• **${o.nombre}** — ${fmtNumero(o.precio)} 🪙 · caduca <t:${Math.floor(o.caduca / 1000)}:R>`)
                          .join("\n")
                    : "No tienes ofertas en el mercado."),
        )
        .setColor(0x1abc9c);
    const filasUi = [];
    if (filas.length) {
        filasUi.push(
            fila(
                new StringSelectMenuBuilder()
                    .setCustomId("mercado_retirar_sel")
                    .setPlaceholder("Retirar una oferta")
                    .addOptions(filas.map((o) => ({ label: `${o.nombre} · ${fmtNumero(o.precio)}`.slice(0, 100), value: String(o.id) }))),
            ),
        );
    }
    filasUi.push(fila(boton("mercado_ver_1", "◀ Mercado")));
    return { content: "", embeds: [embed], components: filasUi };
}

/** ⭐ Los objetos de la tienda que sigue alguien, con un menú para dejar de seguir. */
function buildDeseos(userId, aviso = null) {
    const lista = deseos.lista(userId);
    const embed = new EmbedBuilder()
        .setTitle("⭐ Tu lista de deseos")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lista.length
                    ? lista
                          .map(
                              (i) =>
                                  `• **${i.nombre}** — ${fmtNumero(i.precio)} 🪙${i.stock !== null && i.stock <= 0 ? " · ❌ agotado" : ""}`,
                          )
                          .join("\n")
                    : "No sigues ningún objeto. Pulsa ⭐ al confirmar una compra para seguirlo.") +
                "\n\nTe aviso por DM cuando uno agotado vuelve a tener stock o baja de precio.",
        )
        .setFooter({ text: `Sigues ${lista.length} de ${deseos.LIMITE}` })
        .setColor(0xf1c40f);
    const filasUi = [];
    if (lista.length) {
        filasUi.push(
            fila(
                new StringSelectMenuBuilder()
                    .setCustomId("mercado_deseo_quitar_sel")
                    .setPlaceholder("Dejar de seguir")
                    .addOptions(lista.map((i) => ({ label: i.nombre.slice(0, 100), value: String(i.tiendaId) }))),
            ),
        );
    }
    filasUi.push(fila(boton("tienda_volver_1", "◀ Catálogo")));
    return { content: "", embeds: [embed], components: filasUi };
}

module.exports = {
    buildElegirObjeto,
    buildAccionesObjeto,
    buildElegirDestinatario,
    buildConfirmarRegalo,
    buildConfirmarVenta,
    buildMercado,
    buildMisOfertas,
    buildDeseos,
};
