// 🔊 El panel de sonidos (/sonidos): un botón por sonido (de 20 en 20, o de 15 en 15 si hay categorías), con búsqueda por nombre
// (#323), un menú de categorías (#325), un sonido al azar (#324) y los más usados (#297). El filtro viaja en el customId de los
// botones de página (`sonido_pagina_<n>|<categoría>|<búsqueda>`), así que el panel no guarda estado.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const sonidos = require("../systems/sonidos");
const ajustes = require("../systems/sonidos/ajustes");
const { trozos } = require("./filas");

const POR_PAGINA = 20;
const POR_PAGINA_CON_CATEGORIAS = 15; // una fila menos de sonidos, para el menú de categorías
const BUSQUEDA_MAX = 24;
const TODAS = "*";

/** El filtro en el customId: vacío si no hay ninguno (los botones de siempre), y `|categoría|búsqueda` si lo hay. */
const sufijo = ({ categoria = "", texto = "" }) => (categoria || texto ? `|${categoria}|${texto}` : "");

/** La búsqueda limpia: sin «|» (separa el filtro en el customId) ni espacios de más, y de hasta BUSQUEDA_MAX caracteres. */
const limpiarBusqueda = (texto) =>
    String(texto ?? "")
        .replace(/\|/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, BUSQUEDA_MAX);

/** Lo que dice el panel del filtro activo, o "". */
function textoFiltro({ categoria, texto }) {
    return [categoria ? `categoría «${categoria}»` : "", texto ? `nombre con «${texto}»` : ""].filter(Boolean).join(" y ");
}

function menuCategorias(guildId, categoriaActual) {
    const existentes = ajustes.categorias(guildId).slice(0, 23);
    const opciones = [
        { label: "Todas", value: TODAS },
        ...existentes.map((c) => ({ label: c, value: c })),
        { label: ajustes.SIN_CATEGORIA, value: ajustes.SIN_CATEGORIA },
    ];
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("sonido_categoria")
            .setPlaceholder("Categoría")
            .addOptions(opciones.map((o) => ({ ...o, default: o.value === (categoriaActual || TODAS) }))),
    );
}

/** La fila de abajo: buscar (o quitar la búsqueda), aleatorio, más usados y, si hay varias páginas, ◀ y ▶. */
function filaControles(filtro, p, paginas) {
    const buscar = filtro.texto
        ? new ButtonBuilder().setCustomId(`sonido_limpiar|${filtro.categoria}`).setLabel("❌ Quitar búsqueda").setStyle(ButtonStyle.Danger)
        : new ButtonBuilder().setCustomId(`sonido_buscar|${filtro.categoria}`).setLabel("🔍 Buscar").setStyle(ButtonStyle.Secondary);
    const botones = [
        buscar,
        new ButtonBuilder().setCustomId("sonido_azar").setLabel("🎲 Aleatorio").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("sonido_top").setLabel("🏆 Más usados").setStyle(ButtonStyle.Secondary),
    ];
    if (paginas > 1) {
        botones.push(
            new ButtonBuilder()
                .setCustomId(`sonido_pagina_${p - 1}${sufijo(filtro)}`)
                .setLabel("◀")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(p === 0),
            new ButtonBuilder()
                .setCustomId(`sonido_pagina_${p + 1}${sufijo(filtro)}`)
                .setLabel("▶")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(p >= paginas - 1),
        );
    }
    return new ActionRowBuilder().addComponents(...botones);
}

function descripcion(total, hayFiltro, filtro) {
    if (total) return "Pulsa uno: suena en el canal donde esté el bot (con /conectar), o entra a tu canal, lo toca y se sale.";
    if (hayFiltro) return `No hay sonidos con ${textoFiltro(filtro)}. Prueba con otra búsqueda o quita el filtro.`;
    return "Todavía no hay sonidos. Un admin puede añadirlos desde /paneladmin → 🔊 Sonidos.";
}

/**
 * La pantalla de /sonidos. `filtro` = { categoria, texto }: sin categoría ni texto salen todos los sonidos.
 * Un sonido con roles asignados lleva 🔒 (quien no tiene el rol recibe un aviso al pulsarlo).
 */
function pantallaSonidos(guildId, pagina = 0, filtro = {}) {
    const f = { categoria: filtro.categoria || "", texto: limpiarBusqueda(filtro.texto) };
    const hayCategorias = ajustes.categorias(guildId).length > 0;
    const porPagina = hayCategorias ? POR_PAGINA_CON_CATEGORIAS : POR_PAGINA;
    const hayFiltro = Boolean(f.categoria || f.texto);
    const lista = sonidos.listar(guildId, f);
    const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
    const p = Math.min(Math.max(0, Number(pagina) || 0), paginas - 1);
    const embed = new EmbedBuilder()
        .setTitle("🔊 Sonidos")
        .setColor(0x3498db)
        .setDescription(descripcion(lista.length, hayFiltro, f));
    if (lista.length) {
        const filtroTexto = textoFiltro(f);
        embed.setFooter({ text: `Página ${p + 1} de ${paginas} · ${lista.length} sonidos${filtroTexto ? ` · ${filtroTexto}` : ""}` });
    }

    const restringidos = ajustes.conRestriccion(guildId);
    const botones = lista.slice(p * porPagina, (p + 1) * porPagina).map((s) =>
        new ButtonBuilder()
            .setCustomId(`sonido_play_${s.id}`)
            .setLabel(`${restringidos.has(s.id) ? "🔒" : "🔊"} ${s.nombre}`.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
    );
    const filas = trozos(botones).map((grupo) => new ActionRowBuilder().addComponents(...grupo));
    if (hayCategorias) filas.unshift(menuCategorias(guildId, f.categoria));
    // Sin ningún sonido en el servidor no hay nada que controlar: el panel queda sin botones.
    if (lista.length || hayFiltro) filas.push(filaControles(f, p, paginas));
    return { content: "", embeds: [embed], components: filas };
}

/** El formulario de buscar por nombre (`categoria` mantiene la categoría elegida). */
function modalBuscar(categoria = "") {
    return new ModalBuilder()
        .setCustomId(`sonido_modal_buscar|${categoria}`)
        .setTitle("🔍 Buscar un sonido")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("texto")
                    .setLabel("Parte del nombre")
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(BUSQUEDA_MAX)
                    .setPlaceholder("gol")
                    .setRequired(true),
            ),
        );
}

module.exports = { pantallaSonidos, modalBuscar, limpiarBusqueda, POR_PAGINA, POR_PAGINA_CON_CATEGORIAS, TODAS };
