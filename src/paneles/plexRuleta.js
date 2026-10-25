// 🎲 Ruleta de películas (#576) en /plex → ⭐ Reseñas: la ficha de la película que ha salido, sus botones (⭐ Puntuar,
// 📝 Quiero ver, 🎬 Otra) y los filtros en menús (género, década y, cuando las fichas la tengan, duración). Solo
// payloads; la tirada la hace systems/plexRuleta. Los filtros y la película en pantalla viajan en los customId.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const plexRuleta = require("../systems/plexRuleta");
const plexResenas = require("../systems/plexResenas");
const plexAvisos = require("../systems/plexAvisos");

const COLOR = 0xe5a00d;
const TODOS = "todos";
const MAX_ID = 100;

const num = (n) => String(n).replace(".", ",");
const recorte = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const veces = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const duracionTexto = (min) => (min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);

// ─── El estado en el customId ───────────────────────────────────────────────
/** `<genero>_<decada>_<duracion>_<película en pantalla>`: el género es un slug (sin «_») y la clave de Plex, un número. */
function estadoId(prefijo, filtros, ratingKey = "") {
    const f = plexRuleta.normalizarFiltros(filtros);
    const base = `${prefijo}${f.genero}_${f.decada}_${f.duracion}_`;
    const rk = /^[A-Za-z0-9-]+$/.test(String(ratingKey || "")) ? String(ratingKey) : "";
    // Si no cabe en los 100 caracteres de Discord, se pierde la película en pantalla (🎬 Otra podría repetirla).
    return `${base}${rk}`.length <= MAX_ID ? `${base}${rk}` : base;
}

/** Lo contrario de estadoId: los filtros y la película en pantalla (o null) del resto del customId. */
function leerEstado(resto) {
    const [genero = "", decada = "", duracion = "", ratingKey = ""] = String(resto || "").split("_");
    return {
        filtros: plexRuleta.normalizarFiltros({ genero, decada, duracion }),
        ratingKey: /^[A-Za-z0-9-]+$/.test(ratingKey) ? ratingKey : null,
    };
}

// ─── Las piezas ─────────────────────────────────────────────────────────────
function textoFiltros(f, facetas) {
    const partes = [];
    if (f.genero) partes.push(facetas.generos.find((g) => g.id === f.genero)?.nombre || f.genero);
    if (f.decada) partes.push(`años ${f.decada}`);
    if (f.duracion) partes.push(`hasta ${duracionTexto(f.duracion)}`);
    return partes.join(" · ");
}

/** La ficha de la película: géneros, director, biblioteca, la media del servidor y de cuántas ha salido. */
function descripcionFicha(guildId, r, aviso) {
    const p = r.pelicula;
    const lineas = [];
    if (aviso) lineas.push(aviso, "");
    if (p.generos.length) lineas.push(`🎭 ${p.generos.slice(0, 4).join(", ")}`);
    if (p.directores.length) lineas.push(`🎥 ${p.directores.slice(0, 2).join(", ")}`);
    if (p.biblioteca) lineas.push(`📚 ${p.biblioteca}`);
    const t = plexResenas.titulo(guildId, plexResenas.clavePeli(p.titulo, p.anio));
    if (t.votos) lineas.push(`⭐ **${num(t.media)} ★** en el servidor · ${veces(t.votos, "voto", "votos")}`);
    const filtros = textoFiltros(r.filtros, r.facetas);
    lineas.push(
        "",
        r.unica
            ? "🎲 No hay otra: es la única que no has visto con estos filtros."
            : `🎲 Ha salido de entre ${veces(r.total, "película que no has visto", "películas que no has visto")}${filtros ? ` (${filtros})` : ""}.`,
    );
    return lineas.join("\n");
}

function botonesFicha(guildId, userId, r) {
    const p = r.pelicula;
    const enLista = p.tmdb ? plexAvisos.enQuieroVer(guildId, userId, "movie", p.tmdb) : false;
    return new ActionRowBuilder().addComponents(
        // No la ha visto (la ruleta nunca propone lo visto) y solo se valora lo visto: se puntúa al verla.
        new ButtonBuilder()
            .setCustomId("plex_ruleta_puntuar")
            .setLabel("⭐ Puntuar al verla")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(estadoId("plex_ruleta_quiero_", r.filtros, p.ratingKey))
            .setLabel(enLista ? "✅ En tu lista" : "📝 Quiero ver")
            .setStyle(ButtonStyle.Success)
            .setDisabled(enLista || !p.tmdb),
        new ButtonBuilder()
            .setCustomId(estadoId("plex_ruleta_otra_", r.filtros, p.ratingKey))
            .setLabel("🎬 Otra")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(r.unica),
        new ButtonBuilder().setCustomId("plex_resenas").setLabel("⬅️ Reseñas").setStyle(ButtonStyle.Secondary),
    );
}

/** Un menú de filtro: «todos» y las opciones; la elegida, marcada. */
function menu(campo, r, placeholder, todos, opciones) {
    const id = estadoId(`plex_sel_ruleta_${campo}_`, r.filtros, r.pelicula?.ratingKey);
    const elegido = String(r.filtros[campo] || "");
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(id)
            .setPlaceholder(placeholder)
            .addOptions([
                { label: todos, value: TODOS, default: !elegido },
                ...opciones.map((o) => ({ ...o, label: recorte(o.label, 100), default: o.value === elegido })),
            ]),
    );
}

function menusFiltros(r) {
    const { generos, decadas, duraciones } = r.facetas;
    const filas = [];
    if (generos.length)
        filas.push(
            menu(
                "genero",
                r,
                "🎭 Género",
                "🎭 Cualquier género",
                generos.map((g) => ({ label: g.nombre, value: g.id, description: veces(g.n, "sin ver", "sin ver") })),
            ),
        );
    if (decadas.length)
        filas.push(
            menu(
                "decada",
                r,
                "📼 Década",
                "📼 Cualquier década",
                decadas.map((d) => ({ label: `Años ${d.decada}`, value: String(d.decada), description: veces(d.n, "sin ver", "sin ver") })),
            ),
        );
    if (duraciones.length)
        filas.push(
            menu(
                "duracion",
                r,
                "⏱️ Duración máxima",
                "⏱️ Sin límite de duración",
                duraciones.map((m) => ({ label: `Hasta ${duracionTexto(m)}`, value: String(m) })),
            ),
        );
    return filas;
}

// ─── La pantalla ────────────────────────────────────────────────────────────
/** La pantalla de la ruleta con el resultado de plexRuleta.tirar: la ficha, sus botones y los filtros (como mucho 4 filas). */
function pantallaRuleta(guildId, userId, r, aviso = "") {
    const embed = new EmbedBuilder().setColor(COLOR);
    const volver = new ButtonBuilder().setCustomId("plex_resenas").setLabel("⬅️ Reseñas").setStyle(ButtonStyle.Secondary);
    if (!r.ok) {
        embed.setTitle("🎲 Ruleta de películas").setDescription(`${aviso ? `${aviso}\n\n` : ""}${r.motivo}`);
        return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(volver)] };
    }
    if (!r.pelicula) {
        const quitar = new ButtonBuilder()
            .setCustomId(estadoId("plex_ruleta_otra_", plexRuleta.SIN_FILTROS))
            .setLabel("🧹 Quitar filtros")
            .setStyle(ButtonStyle.Primary);
        embed
            .setTitle("🎲 Ruleta de películas")
            .setDescription(
                `${aviso ? `${aviso}\n\n` : ""}No queda ninguna película sin ver con estos filtros (${textoFiltros(r.filtros, r.facetas)}). Cambia alguno o quítalos.`,
            );
        return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(quitar, volver), ...menusFiltros(r)] };
    }
    const p = r.pelicula;
    embed
        .setTitle(`🎲 ${p.titulo}${p.anio ? ` (${p.anio})` : ""}`)
        .setDescription(descripcionFicha(guildId, r, aviso))
        .setFooter({ text: "⭐ Se puntúa al verla: al terminarla te llega un DM. Los filtros, en los menús de abajo." });
    return { content: "", embeds: [embed], components: [botonesFicha(guildId, userId, r), ...menusFiltros(r)] };
}

module.exports = { pantallaRuleta, estadoId, leerEstado, TODOS };
