// 📚 Pantallas de las listas de películas (#575), desde /plex → ⭐ Reseñas: mis listas y las públicas, una lista con sus
// títulos (elegir uno para subirlo, bajarlo, quitarlo o abrir su ficha), la búsqueda en Plex para añadir, el formulario y
// la confirmación de borrar. Solo payloads; las reglas están en systems/plexListas.js.
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
const plexListas = require("../systems/plexListas");
const plexResenas = require("../systems/plexResenas");

const COLOR = 0xe5a00d;
const LISTAS_POR_PAGINA = 5;
const ITEMS_POR_PAGINA = 10;
const TITULO_VISTA = { mias: "📚 Mis listas", publicas: "🌍 Listas públicas" };

const recorte = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ""));
const num = (n) => String(n).replace(".", ",");
const boton = (id, etiqueta, estilo = ButtonStyle.Secondary, desactivado = false) =>
    new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo).setDisabled(desactivado);
const conAnio = (t) => `${t.titulo}${t.anio ? ` (${t.anio})` : ""}`;
const icono = (t) => (t.tipo === "show" ? "📺" : "🎬");

/** ◀ ▶ si hace falta, con el prefijo de su pantalla. */
function navegacion(prefijo, pagina, total) {
    if (total <= 1) return [];
    return [
        boton(`${prefijo}${pagina - 1}`, "◀", ButtonStyle.Secondary, pagina === 0),
        boton(`${prefijo}${pagina + 1}`, "▶", ButtonStyle.Secondary, pagina >= total - 1),
    ];
}

const paginar = (lista, porPagina, pagina) => {
    const total = Math.max(1, Math.ceil(lista.length / porPagina));
    const p = Math.max(0, Math.min(total - 1, Number(pagina) || 0));
    return { p, total, trozo: lista.slice(p * porPagina, (p + 1) * porPagina) };
};

/** 📚 Mis listas o 🌍 Públicas: cinco por página con su botón para abrirla. */
function pantallaListas(guildId, userId, vista = "mias", pagina = 0, aviso = "") {
    const v = vista === "publicas" ? "publicas" : "mias";
    const todas = v === "mias" ? plexListas.deUsuario(guildId, userId) : plexListas.publicas(guildId);
    const { p, total, trozo } = paginar(todas, LISTAS_POR_PAGINA, pagina);
    const lineas = trozo.map((l) => {
        const dueno = v === "publicas" ? ` · de <@${l.userId}>` : l.publica ? " · 🌍" : " · 🔒";
        return `**${l.titulo}** — ${l.total} ${l.total === 1 ? "título" : "títulos"}${dueno}`;
    });
    const vacia = v === "mias" ? "Todavía no tienes listas. Crea una con **➕ Nueva lista**." : "Nadie ha publicado listas todavía.";
    const embed = new EmbedBuilder()
        .setTitle(`⭐ Reseñas · ${TITULO_VISTA[v]}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lineas.length ? lineas.join("\n") : vacia) +
                (total > 1 ? `\n\nPágina ${p + 1} de ${total}` : ""),
        )
        .setFooter({ text: `Hasta ${plexListas.MAX_LISTAS} listas por persona y ${plexListas.MAX_ITEMS} títulos por lista.` });
    const estilo = (x) => (x === v ? ButtonStyle.Primary : ButtonStyle.Secondary);
    const filas = [
        new ActionRowBuilder().addComponents(
            boton("plex_listas_mias", "📚 Mis listas", estilo("mias")),
            boton("plex_listas_publicas", "🌍 Públicas", estilo("publicas")),
            boton("plex_listas_nueva", "➕ Nueva lista", ButtonStyle.Success),
            boton("plex_resenas_mias", "⬅️ Reseñas"),
        ),
    ];
    if (trozo.length) {
        filas.push(new ActionRowBuilder().addComponents(trozo.map((l) => boton(`plex_lista_ver_${l.id}_0`, recorte(l.titulo, 30)))));
    }
    const nav = navegacion(`plex_listas_pag_${v}_`, p, total);
    if (nav.length) filas.push(new ActionRowBuilder().addComponents(nav));
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** «**3.** 🎬 **Dune** (2021) · 4,5 ★». */
function lineaItem(guildId, item, elegido) {
    const r = plexResenas.resumen(guildId, item.clave);
    const nota = r.votos ? ` · ${num(r.media)} ★` : "";
    return `${elegido ? "👉 " : ""}**${item.posicion}.** ${icono(item)} **${conAnio(item)}**${nota}`;
}

/** Las acciones sobre el título elegido: subir, bajar y quitar (si es tu lista) y la ficha. */
function filaElegido(lista, item, total, esDueno) {
    const base = `${lista.id}_${item.posicion}`;
    const botones = [];
    if (esDueno) {
        botones.push(
            boton(`plex_lista_sub_${base}`, "⬆️ Subir", ButtonStyle.Secondary, item.posicion === 1),
            boton(`plex_lista_baj_${base}`, "⬇️ Bajar", ButtonStyle.Secondary, item.posicion === total),
            boton(`plex_lista_quitar_${base}`, "❌ Quitar", ButtonStyle.Danger),
        );
    }
    botones.push(boton(`plex_lista_ficha_${base}`, "⭐ Ficha", ButtonStyle.Primary));
    return new ActionRowBuilder().addComponents(botones);
}

/**
 * Una lista: sus títulos (diez por página), un desplegable para elegir uno y, si es tuya, ➕ Añadir, ✏️ Editar, la
 * visibilidad y 🗑️ Borrar. `elegido`: la posición del título elegido, o 0.
 */
function pantallaLista(guildId, userId, listaId, { pagina = 0, elegido = 0 } = {}, aviso = "") {
    const lista = plexListas.obtener(listaId);
    if (!plexListas.puedeVer(lista, userId)) return pantallaListas(guildId, userId, "mias", 0, "❌ Esa lista ya no existe o es privada.");
    const esDueno = lista.userId === String(userId);
    const todos = plexListas.items(lista.id);
    const sel = todos.find((i) => i.posicion === Number(elegido)) || null;
    const { p, total, trozo } = paginar(todos, ITEMS_POR_PAGINA, sel ? Math.floor((sel.posicion - 1) / ITEMS_POR_PAGINA) : pagina);
    const lineas = trozo.map((i) => lineaItem(guildId, i, sel?.clave === i.clave));
    const embed = new EmbedBuilder()
        .setTitle(`📚 ${lista.titulo}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `${lista.publica ? "🌍 Pública" : "🔒 Privada"} · de <@${lista.userId}> · ${todos.length} ${todos.length === 1 ? "título" : "títulos"}` +
                (lista.descripcion ? `\n> ${lista.descripcion}` : "") +
                `\n\n${lineas.length ? lineas.join("\n") : esDueno ? "Vacía. Añade títulos de Plex con **➕ Añadir**." : "Vacía."}` +
                (total > 1 ? `\n\nPágina ${p + 1} de ${total}` : ""),
        );
    const filas = [];
    if (trozo.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`plex_sel_lista_item_${lista.id}`)
                    .setPlaceholder("Elige un título")
                    .addOptions(
                        trozo.map((i) => ({
                            label: recorte(`${i.posicion}. ${conAnio(i)}`, 100),
                            value: String(i.posicion),
                            default: sel?.clave === i.clave,
                        })),
                    ),
            ),
        );
    }
    if (sel) filas.push(filaElegido(lista, sel, todos.length, esDueno));
    if (esDueno) {
        filas.push(
            new ActionRowBuilder().addComponents(
                boton(`plex_lista_add_${lista.id}`, "➕ Añadir", ButtonStyle.Success, todos.length >= plexListas.MAX_ITEMS),
                boton(`plex_lista_editar_${lista.id}`, "✏️ Editar"),
                boton(`plex_lista_vis_${lista.id}`, lista.publica ? "🔒 Hacer privada" : "🌍 Hacer pública"),
                boton(`plex_lista_borrar_${lista.id}`, "🗑️ Borrar", ButtonStyle.Danger),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            ...navegacion(`plex_lista_ver_${lista.id}_`, p, total),
            boton(esDueno ? "plex_listas_mias" : "plex_listas_publicas", "⬅️ Listas"),
        ),
    );
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** Los resultados de buscar en Plex para añadir a la lista. */
function pantallaBuscar(lista, texto, encontrados) {
    // El valor de una opción admite 100 caracteres: un título tan largo que su clave no quepa no se puede elegir.
    const resultados = encontrados.filter((t) => t.clave.length <= 100);
    const embed = new EmbedBuilder()
        .setTitle(`➕ Añadir a «${lista.titulo}»`)
        .setColor(COLOR)
        .setDescription(
            resultados.length
                ? `Resultados en Plex para **${recorte(texto, 50)}**. Elige uno para añadirlo al final de la lista.`
                : `No hay nada en Plex que se llame **${recorte(texto, 50)}**. Prueba con otra parte del título.`,
        );
    const filas = [];
    if (resultados.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`plex_sel_lista_add_${lista.id}`)
                    .setPlaceholder("Elige el título")
                    .addOptions(
                        resultados.map((t) => ({
                            label: recorte(conAnio(t), 100),
                            value: t.clave,
                            emoji: icono(t),
                            description: t.tipo === "show" ? "Serie" : "Película",
                        })),
                    ),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            boton(`plex_lista_add_${lista.id}`, "🔎 Buscar otro", ButtonStyle.Primary),
            boton(`plex_lista_ver_${lista.id}_0`, "⬅️ Volver"),
        ),
    );
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** ¿Seguro que la borras? */
function confirmarBorrar(lista) {
    return {
        content: `¿Borrar la lista **${lista.titulo}** con todos sus títulos? No se puede deshacer.`,
        embeds: [],
        components: [
            new ActionRowBuilder().addComponents(
                boton(`plex_lista_borrarsi_${lista.id}`, "🗑️ Sí, borrar", ButtonStyle.Danger),
                boton(`plex_lista_ver_${lista.id}_0`, "↩️ No"),
            ),
        ],
        allowedMentions: { parse: [] },
    };
}

/** El formulario de crear (sin lista) o editar una lista. */
function formularioLista(lista = null) {
    const titulo = new TextInputBuilder()
        .setCustomId("titulo")
        .setLabel("Título de la lista")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(plexListas.TITULO_MAX)
        .setRequired(true)
        .setPlaceholder("Top 10 de Nolan")
        .setValue(lista?.titulo || "");
    const descripcion = new TextInputBuilder()
        .setCustomId("descripcion")
        .setLabel("Descripción (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(plexListas.DESCRIPCION_MAX)
        .setRequired(false)
        .setValue(lista?.descripcion || "");
    return new ModalBuilder()
        .setCustomId(lista ? `plex_modal_lista_editar_${lista.id}` : "plex_modal_lista_nueva")
        .setTitle(lista ? "✏️ Editar lista" : "📚 Nueva lista")
        .addComponents(new ActionRowBuilder().addComponents(titulo), new ActionRowBuilder().addComponents(descripcion));
}

/** El formulario de buscar un título en Plex para añadirlo. */
function formularioBuscar(listaId) {
    return new ModalBuilder()
        .setCustomId(`plex_modal_lista_buscar_${listaId}`)
        .setTitle("🔎 Buscar en Plex")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("texto")
                    .setLabel("Título (o parte) de la película o serie")
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(2)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
        );
}

module.exports = { pantallaListas, pantallaLista, pantallaBuscar, confirmarBorrar, formularioLista, formularioBuscar };
