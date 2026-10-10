// Panel de /tienda, en pestañas: 🛒 Catálogo (páginas, filtros, confirmación y resultado de una compra), 🎒 Inventario
// (tus objetos, con Usar) y 🧾 Mis compras. Solo construyen embeds y botones; los datos y el cobro están en
// systems/tienda y systems/objetos. Los filtros (categoría, rareza y búsqueda) los guarda el comando por persona.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { botonSacar } = require("./economia");
const dinero = require("../systems/dinero");
const objetos = require("../systems/objetos");
const tienda = require("../systems/tienda");

const ITEMS_POR_PAGINA = 4; // una fila con un botón de compra por objeto
const HISTORIAL_POR_PAGINA = 5;
const INVENTARIO_POR_PAGINA = 5; // una fila con un botón de Usar por objeto
// Valor del menú que quita el filtro (Discord no admite un valor vacío).
const SIN_FILTRO = "__todas__";

/**
 * Pestañas de /tienda (la actual, resaltada), en la última fila de sus pantallas. La de Inventario lleva "_tab": sin
 * eso era igual que ⬅️ Anterior de la página 2 del inventario y Discord rechazaba el mensaje (COMPONENT_CUSTOM_ID_DUPLICATED).
 */
function filaPestanasTienda(actual) {
    const boton = (id, customId, label) =>
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(id === actual ? ButtonStyle.Primary : ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(
        boton("catalogo", "tienda_volver_1", "🛒 Catálogo"),
        boton("inventario", "tienda_inv_1_tab", "🎒 Inventario"),
        boton("compras", "historial_ver_1", "🧾 Mis compras"),
    );
}

/** Menús de categoría y de rareza de la pestaña `tab`; cada uno en su fila. */
function filasFiltros(tab, filtros = {}) {
    const valores = tienda.valoresFiltro();
    const menu = (tipo, etiqueta, lista, actual) =>
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`tienda_filtro_${tipo}_${tab}`)
                .setPlaceholder(actual ? `${etiqueta}: ${actual}`.slice(0, 150) : `${etiqueta}: todas`)
                .addOptions([
                    { label: `${etiqueta}: todas`, value: SIN_FILTRO, default: !actual },
                    ...lista.slice(0, 24).map((v) => ({
                        label: v.slice(0, 100),
                        value: v.slice(0, 100),
                        default: v === actual,
                    })),
                ]),
        );
    return [
        menu("categoria", "Categoría", valores.categorias, filtros.categoria),
        menu("rareza", "Rareza", valores.rarezas, filtros.rareza),
    ];
}

/** Botones de búsqueda por nombre o tipo para la pestaña `tab` (y quitarla, si hay una activa). */
function botonesBuscar(tab, filtros = {}) {
    const botones = [
        new ButtonBuilder()
            .setCustomId(`tienda_buscar_${tab}`)
            .setLabel(filtros.busqueda ? `🔍 ${filtros.busqueda}`.slice(0, 80) : "🔍 Buscar")
            .setStyle(ButtonStyle.Secondary),
    ];
    if (filtros.busqueda) {
        botones.push(
            new ButtonBuilder().setCustomId(`tienda_nobuscar_${tab}`).setLabel("✖ Quitar búsqueda").setStyle(ButtonStyle.Secondary),
        );
    }
    return botones;
}

function colorPorRareza(rareza) {
    switch ((rareza || "").toLowerCase()) {
        case "legendario":
            return 0xf1c40f;
        case "épico":
            return 0x9b59b6;
        case "raro":
            return 0x3498db;
        case "común":
            return 0x95a5a6;
        default:
            return 0x2980b9;
    }
}

function emojiPorTipo(tipo) {
    switch ((tipo || "").toLowerCase()) {
        case "rol":
            return "🎭";
        case "consumible":
            return "🎟️";
        case "arma":
            return "⚔️";
        case "armadura":
            return "🛡️";
        case "moneda":
            return "🪙";
        default:
            return "📦";
    }
}

/** El campo del embed de un objeto del catálogo: nombre con precio y stock y, debajo, tipo, rareza y avisos. */
function campoObjetoCatalogo(item, isAdmin) {
    let name = `${emojiPorTipo(item.tipo)} ${isAdmin ? `[#${item.tiendaId}] ` : ""}${item.nombre} — ${item.precio} 🪙`;
    if (item.unico) name = "🟢 " + name;
    if (item.stock !== null) name += ` (Stock: ${item.stock})`;
    let value = item.descripcion ? item.descripcion.slice(0, 300) : "Sin descripción";
    if (item.tipo) value += `\nTipo: ${item.tipo}`;
    if (item.rareza) value += `  •  Rareza: ${item.rareza}`;
    if (item.stock !== null && item.stock > 0 && item.stock <= 3) value += "  \n⚠️ ¡Últimas unidades!";
    if (item.stock !== null && item.stock === 0) value += "  \n❌ Agotado";
    if (item.rolId || (item.tipo || "").toLowerCase() === "rol") value += "\n🎭 Asigna rol automáticamente al comprar";
    return { name: name.slice(0, 256), value: value.slice(0, 1024), inline: false };
}

/** La fila de compra de una página: un botón por objeto (apagado si está agotado). */
function filaCompras(pageItems) {
    const compraRow = new ActionRowBuilder();
    pageItems.forEach((item) => {
        const agotado = item.stock !== null && item.stock === 0;
        compraRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`tienda_confirmar_${item.tiendaId}`)
                .setLabel(agotado ? `${item.nombre} (agotado)` : `🛒 ${item.nombre}`)
                .setStyle(agotado ? ButtonStyle.Danger : ButtonStyle.Primary)
                .setDisabled(agotado),
        );
    });
    return compraRow;
}

/** Una página del catálogo (ya filtrado): embed con los objetos, un botón de compra por cada uno y los filtros. */
function buildTiendaPage(items, pagina, isAdmin, filtros = {}) {
    const totalPaginas = Math.max(1, Math.ceil(items.length / ITEMS_POR_PAGINA));
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;

    const inicio = (pagina - 1) * ITEMS_POR_PAGINA;
    const pageItems = items.slice(inicio, inicio + ITEMS_POR_PAGINA);
    const hayFiltros = Boolean(filtros.categoria || filtros.rareza || filtros.busqueda);

    const embed = new EmbedBuilder()
        .setTitle("🛒 Tienda del Servidor")
        .setDescription(
            !items.length
                ? hayFiltros
                    ? "No hay objetos con estos filtros. Cambia el filtro o quítalo."
                    : "La tienda está vacía de momento."
                : "Compra objetos con tu 💵 efectivo y 🥷 dinero negro. Pulsa un botón para comprar.",
        )
        .setColor(colorPorRareza(pageItems[0]?.rareza))
        .setFooter({ text: `Página ${pagina} de ${totalPaginas} — ${items.length} objetos en total` });

    if (pageItems[0]?.imagen) embed.setThumbnail(pageItems[0].imagen);

    pageItems.forEach((item) => {
        embed.addFields(campoObjetoCatalogo(item, isAdmin));
    });

    const filas = [];
    if (pageItems.length) filas.push(filaCompras(pageItems));

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tienda_page_${pagina - 1}`)
            .setLabel("◀ Anterior")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 1),
        new ButtonBuilder()
            .setCustomId(`tienda_page_${pagina + 1}`)
            .setLabel("Siguiente ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= totalPaginas),
        ...botonesBuscar("catalogo", filtros),
    );
    filas.push(navRow, ...filasFiltros("catalogo", filtros), filaPestanasTienda("catalogo"));

    return { content: "", embeds: [embed], components: filas };
}

function buildConfirmacion(item, saldo, tiendaCfg, userId = null) {
    const embed = new EmbedBuilder()
        .setTitle("¿Confirmar compra?")
        .setDescription(
            `**${item.nombre}**\n${item.descripcion}\n\n` +
                `💰 Precio: **${item.precio} monedas**\n` +
                `${item.stock !== null ? `Stock disponible: ${item.stock}\n` : ""}` +
                `Tu efectivo: **${saldo} monedas**${saldo < item.precio ? " (no te llega: saca del banco)" : ""}\n\n` +
                `Política: cooldown **${Number(tiendaCfg.buy_cooldown_sec || 0)}s** · límite diario **${Number(tiendaCfg.daily_limit || 0) || "∞"}**`,
        )
        .setColor(0xf39c12);
    if (item.imagen) embed.setThumbnail(item.imagen);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tienda_comprar_${item.tiendaId}`).setLabel("✅ Confirmar compra").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("tienda_cancelar").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    );
    // Si no te llega el efectivo pero tienes en el banco, sacarlo sin salir de aquí.
    if (saldo < item.precio && userId && dinero.banco(userId) > 0) row.addComponents(botonSacar(`tienda_confirmar_${item.tiendaId}`));
    return { embeds: [embed], components: [row] };
}

function buildCompraRealizada(item, rolMsg, saldo) {
    // Después de comprar: volver, verlo en el inventario o usarlo ya (si hace algo al usarse).
    const embed = new EmbedBuilder()
        .setTitle("✅ ¡Compra realizada!")
        .setDescription(
            `Has comprado **${item.nombre}** por **${item.precio} monedas**.${rolMsg}\n\n💵 Efectivo: **${saldo ?? 0} monedas**`,
        )
        .setColor(0x2ecc40);
    if (item.imagen) embed.setThumbnail(item.imagen);
    const volverRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tienda_volver_1").setLabel("⬅️ Volver a la tienda").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("tienda_inv_1").setLabel("🎒 Ver en inventario").setStyle(ButtonStyle.Secondary),
    );
    // Los roles se dan al comprar: "Usar ya" solo para los consumibles.
    if (String(item.tipo || "").toLowerCase() === "consumible") {
        volverRow.addComponents(
            new ButtonBuilder().setCustomId(`tienda_usar_${item.id}_1`).setLabel("🔮 Usar ya").setStyle(ButtonStyle.Success),
        );
    }
    return { content: "", embeds: [embed], components: [volverRow] };
}

/** Pestaña 🧾 Mis compras: una página del historial de compras (con lo gastado en esa página). */
function buildHistorialCompras(historial, pagina) {
    if (!historial.length) {
        const vacio = new EmbedBuilder()
            .setTitle("🧾 Mis compras")
            .setDescription("No tienes compras en la tienda todavía.")
            .setColor(0x95a5a6);
        return { content: "", embeds: [vacio], components: [filaPestanasTienda("compras")] };
    }
    const totalPaginas = Math.ceil(historial.length / HISTORIAL_POR_PAGINA);
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;
    const inicio = (pagina - 1) * HISTORIAL_POR_PAGINA;
    const filas = historial.slice(inicio, inicio + HISTORIAL_POR_PAGINA);
    const totalGastado = filas.reduce((acc, h) => acc - h.cantidad, 0);

    const embed = new EmbedBuilder()
        .setTitle("🧾 Historial de compras")
        .setColor(0x95a5a6)
        .setFooter({ text: `Página ${pagina} de ${totalPaginas} | Total mostrado: ${totalGastado} monedas` });
    for (const h of filas) {
        embed.addFields({
            name: `${h.descripcion}`,
            value: `Fecha: ${new Date(h.fecha).toLocaleString("es-ES")}\nGastado: ${-h.cantidad} monedas`,
            inline: false,
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`historial_prev_${pagina}`)
            .setLabel("⬅️ Anterior")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina === 1),
        new ButtonBuilder()
            .setCustomId(`historial_next_${pagina}`)
            .setLabel("Siguiente ➡️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pagina === totalPaginas),
    );
    return { content: "", embeds: [embed], components: [row, filaPestanasTienda("compras")] };
}

/** El campo del embed de un objeto del inventario: cuántos tienes y su tipo, categoría y rareza. */
function campoObjetoInventario(obj) {
    let value = obj.descripcion ? obj.descripcion.slice(0, 512) : "";
    if (obj.categoria) value += `\nCategoría: ${obj.categoria}`;
    if (obj.rareza) value += `\nRareza: ${obj.rareza}`;
    return {
        name: `${obj.cantidad}x ${emojiPorTipo(obj.tipo)} ${obj.nombre}${obj.tipo ? ` (${obj.tipo})` : ""}`.slice(0, 256),
        value: (value || "—").slice(0, 1024),
    };
}

/** La fila de Usar de una página: un botón por objeto de la página que hace algo al usarse. */
function filaUsar(usables, pagina) {
    return new ActionRowBuilder().addComponents(
        usables.map((obj) =>
            new ButtonBuilder()
                .setCustomId(`tienda_usar_${obj.id}_${pagina}`)
                .setLabel(`Usar ${obj.nombre}`.slice(0, 80))
                .setStyle(ButtonStyle.Success),
        ),
    );
}

/** Pestaña 🎒 Inventario: tus objetos (agrupados, con cuántos tienes), con filtros y un botón de Usar por cada uno que haga algo. */
function buildInventario(userId, pagina = 1, aviso = null, filtros = {}) {
    const busqueda = filtros.busqueda ? filtros.busqueda.toLowerCase() : null;
    const lista = objetos
        .inventarioDe(userId, { categoria: filtros.categoria, rareza: filtros.rareza })
        .filter((o) => !busqueda || o.nombre.toLowerCase().includes(busqueda));
    const totalPaginas = Math.max(1, Math.ceil(lista.length / INVENTARIO_POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), totalPaginas);
    const pagItems = lista.slice((pagina - 1) * INVENTARIO_POR_PAGINA, pagina * INVENTARIO_POR_PAGINA);

    const hayFiltros = Boolean(filtros.categoria || filtros.rareza || filtros.busqueda);
    const embed = new EmbedBuilder()
        .setTitle("🎒 Tu inventario")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lista.length
                    ? `💵 Efectivo: **${dinero.efectivo(userId)}**`
                    : hayFiltros
                      ? "No tienes objetos con estos filtros."
                      : "No tienes objetos todavía. ¡Mira el 🛒 Catálogo!"),
        )
        .setColor(colorPorRareza(pagItems[0]?.rareza))
        .setFooter({ text: `Página ${pagina} de ${totalPaginas} · ${lista.reduce((a, o) => a + o.cantidad, 0)} objetos` });
    for (const obj of pagItems) embed.addFields(campoObjetoInventario(obj));
    if (pagItems[0]?.imagen) embed.setThumbnail(pagItems[0].imagen);

    const filas = [];
    const usables = pagItems.filter(objetos.esUsable);
    if (usables.length) filas.push(filaUsar(usables, pagina));
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tienda_inv_${pagina - 1}`)
                .setLabel("⬅️ Anterior")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pagina <= 1),
            new ButtonBuilder()
                .setCustomId(`tienda_inv_${pagina + 1}`)
                .setLabel("Siguiente ➡️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pagina >= totalPaginas),
            ...botonesBuscar("inventario", filtros),
        ),
        ...filasFiltros("inventario", filtros),
        filaPestanasTienda("inventario"),
    );
    return { content: "", embeds: [embed], components: filas };
}

module.exports = {
    SIN_FILTRO,
    buildTiendaPage,
    buildConfirmacion,
    buildCompraRealizada,
    buildHistorialCompras,
    buildInventario,
};
