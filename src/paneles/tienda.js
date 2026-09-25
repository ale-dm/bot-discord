// Mensajes de /tienda: páginas del catálogo, confirmación y resultado de una compra, e historial de
// compras. Solo construyen embeds y botones; los datos y el cobro están en systems/tienda.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const ITEMS_POR_PAGINA = 4; // máximo 4 items/página: 4 botones comprar + 1 fila paginación = 5 rows
const HISTORIAL_POR_PAGINA = 5;

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

/** Una página del catálogo: embed con los objetos y un botón de compra por cada uno. */
function buildTiendaPage(items, pagina, isAdmin) {
    const totalPaginas = Math.ceil(items.length / ITEMS_POR_PAGINA);
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;

    const inicio = (pagina - 1) * ITEMS_POR_PAGINA;
    const pageItems = items.slice(inicio, inicio + ITEMS_POR_PAGINA);

    const embed = new EmbedBuilder()
        .setTitle("🛒 Tienda del Servidor")
        .setDescription("Compra objetos con tus monedas del banco. Pulsa un botón para comprar.")
        .setColor(colorPorRareza(pageItems[0]?.rareza))
        .setFooter({ text: `Página ${pagina} de ${totalPaginas} — ${items.length} objetos en total` });

    if (pageItems[0]?.imagen) embed.setThumbnail(pageItems[0].imagen);

    pageItems.forEach((item) => {
        let name = `${emojiPorTipo(item.tipo)} ${isAdmin ? `[#${item.tiendaId}] ` : ""}${item.nombre} — ${item.precio} 🪙`;
        if (item.unico) name = "🟢 " + name;
        if (item.stock !== null) name += ` (Stock: ${item.stock})`;
        let value = item.descripcion ? item.descripcion.slice(0, 300) : "Sin descripción";
        if (item.tipo) value += `\nTipo: ${item.tipo}`;
        if (item.rareza) value += `  •  Rareza: ${item.rareza}`;
        if (item.stock !== null && item.stock > 0 && item.stock <= 3) value += "  \n⚠️ ¡Últimas unidades!";
        if (item.stock !== null && item.stock === 0) value += "  \n❌ Agotado";
        if (item.rolId || (item.tipo || "").toLowerCase() === "rol") value += "\n🎭 Asigna rol automáticamente al comprar";
        embed.addFields({ name: name.slice(0, 256), value: value.slice(0, 1024), inline: false });
    });

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
    );

    return { embeds: [embed], components: [compraRow, navRow] };
}

function buildConfirmacion(item, saldo, tiendaCfg) {
    const embed = new EmbedBuilder()
        .setTitle("¿Confirmar compra?")
        .setDescription(
            `**${item.nombre}**\n${item.descripcion}\n\n` +
                `💰 Precio: **${item.precio} monedas**\n` +
                `${item.stock !== null ? `Stock disponible: ${item.stock}\n` : ""}` +
                `Tu saldo: **${saldo} monedas**\n\n` +
                `Política: cooldown **${Number(tiendaCfg.buy_cooldown_sec || 0)}s** · límite diario **${Number(tiendaCfg.daily_limit || 0) || "∞"}**`,
        )
        .setColor(0xf39c12);
    if (item.imagen) embed.setThumbnail(item.imagen);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tienda_comprar_${item.tiendaId}`).setLabel("✅ Confirmar compra").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("tienda_cancelar").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

function buildCompraRealizada(item, rolMsg, saldo) {
    const embed = new EmbedBuilder()
        .setTitle("✅ ¡Compra realizada!")
        .setDescription(
            `Has comprado **${item.nombre}** por **${item.precio} monedas**.${rolMsg}\n\n💰 Saldo restante: **${saldo ?? 0} monedas**`,
        )
        .setColor(0x2ecc40);
    if (item.imagen) embed.setThumbnail(item.imagen);
    const volverRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tienda_volver_1").setLabel("⬅️ Volver a la tienda").setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [volverRow] };
}

/** Una página del historial de compras (con lo gastado en esa página). */
function buildHistorialCompras(historial, pagina) {
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
    return { embeds: [embed], components: [row] };
}

module.exports = { buildTiendaPage, buildConfirmacion, buildCompraRealizada, buildHistorialCompras, colorPorRareza, emojiPorTipo };
