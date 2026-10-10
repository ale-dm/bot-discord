// Pestaña 🏅 Logros: la barra de cada logro, las categorías y filtros, la lista paginada y el menú de reclamar.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const achievements = require("../../systems/achievementsSystem");
const plexLinks = require("../../systems/plexLinks");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexIdiomas = require("../../systems/plexIdiomas");
const { filaPestanasPerfil } = require("../pestanasPerfil");

function barraLogro(progress, target) {
    const ratio = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0;
    const filled = Math.round(ratio * 10);
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.floor(ratio * 100)}%`;
}

// Filtros de 🏅 Logros: por categoría y, dentro de 🍿 Plex, todos los de Plex, solo los trofeos (los de cada serie,
// saga...) o una dificultad. La clave va en los ids de los botones: sin "_". Los de `plex` van en el menú de dentro de
// 🍿 Plex, con su `opcion` como nombre.
const CATEGORIAS = {
    social: "💬 Social",
    xp: "✨ XP y voz",
    casino: "🎰 Casino",
    cripto: "📈 Cripto",
    tienda: "🛒 Tienda",
    plex: "🍿 Plex",
};
const FILTROS_LOGROS = {
    todos: { label: "🏅 Todos los logros", cumple: () => true },
    ...Object.fromEntries(
        Object.entries(CATEGORIAS).map(([c, label]) => [
            `cat-${c}`,
            {
                label,
                categoria: c,
                cumple: (a) => a.category === c,
                ...(c === "plex" ? { plex: true, opcion: "🍿 Todos los de Plex" } : {}),
            },
        ]),
    ),
    trofeos: { label: "🏆 Solo trofeos de Plex", opcion: "🏆 Solo trofeos", plex: true, cumple: (a) => Boolean(a.trofeo) },
    ...Object.fromEntries(
        Object.keys(plexIdiomas.DIFICULTADES).map((d) => [
            `dif-${d}`,
            {
                label: `🍿 Plex: ${plexIdiomas.textoDificultad(d)}`,
                opcion: plexIdiomas.textoDificultad(d),
                plex: true,
                cumple: (a) => a.dificultad === d,
            },
        ]),
    ),
};

/** El filtro al final de los ids ("_cat-plex"); sin filtro ("todos"), los ids de siempre. */
const sufijoFiltro = (filtro) => (filtro && filtro !== "todos" ? `_${filtro}` : "");

/** Menús del filtro: las categorías que tiene y, con 🍿 Plex elegido, otro con lo de dentro (trofeos y dificultades). */
function menusFiltroLogros(ownerId, targetId, filtro, includeHidden, todos) {
    const categorias = new Set(todos.map((a) => a.category));
    const enPlex = Boolean(FILTROS_LOGROS[filtro].plex);
    const categoria = enPlex ? "cat-plex" : filtro;
    const opciones = Object.entries(FILTROS_LOGROS)
        .filter(([k, f]) => k === categoria || k === "todos" || categorias.has(f.categoria))
        .map(([value, f]) => ({
            label: f.label,
            value,
            default: value === categoria,
            ...(value === "cat-plex" ? { description: "Dentro: los trofeos y cada dificultad" } : {}),
        }));
    const secretos = includeHidden ? 1 : 0;
    const filas = [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`perfil_logrosfiltro_${ownerId}_${targetId}_${secretos}`)
                .setPlaceholder("Qué logros ver")
                .addOptions(opciones),
        ),
    ];
    // El de dentro de 🍿 Plex lleva "_plex" al final: sobra al leer el id, pero sin él los dos serían iguales y Discord
    // rechazaría el mensaje.
    if (enPlex) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`perfil_logrosfiltro_${ownerId}_${targetId}_${secretos}_plex`)
                    .setPlaceholder("Qué logros de Plex ver")
                    .addOptions(
                        Object.entries(FILTROS_LOGROS)
                            .filter(([, f]) => f.plex)
                            .map(([value, f]) => ({ label: f.opcion, value, default: value === filtro })),
                    ),
            ),
        );
    }
    return filas;
}

/** Una línea por logro de la página: estado, nombre, categoría, descripción, barra y, si toca, rareza o importación. */
function lineasLogros(slice, { includeHidden, pctImportacion, rarezas }) {
    return slice
        .map((a) => {
            if (a.hidden && !a.completed && !includeHidden) return "❓ **Logro secreto**";
            const status = a.completed ? (a.claimable ? "🎁" : "✅") : "⏳";
            const p = Math.min(a.progress, a.target);
            const rareza = a.category === "plex" && a.completed ? ` · 🏆 ${plexTrofeos.textoRareza(rarezas.get(a.id))}` : "";
            const dificultad = a.dificultad ? ` · ${plexIdiomas.textoDificultad(a.dificultad)}` : "";
            // Desbloqueado con lo antiguo (la primera importación de Plex): da menos monedas.
            const importado = a.claimable && a.importado && pctImportacion < 100 ? ` · 📼 de la importación (${pctImportacion} %)` : "";
            return `${status} **${a.name}** (${a.category}${dificultad})\n${a.desc}\n${barraLogro(p, a.target)}${rareza}${importado}\n`;
        })
        .join("\n");
}

/** Campo "🍿 Plex por dificultad" (solo con 🍿 Plex elegido), o null si no toca. */
function campoPlexDificultad(todos, filtro) {
    // Dentro de 🍿 Plex: de cada dificultad, cuántos tiene de los que hay. Como en Completados, los secretos solo cuentan
    // si los tiene; los trofeos de cada serie, saga... también (no se ven hasta conseguirlos).
    const plexPorDificultad = FILTROS_LOGROS[filtro].plex
        ? todos.filter((a) => a.category === "plex" && a.dificultad && (!a.hidden || a.completed))
        : [];
    if (!plexPorDificultad.length) return null;
    return {
        name: "🍿 Plex por dificultad",
        value: Object.keys(plexIdiomas.DIFICULTADES)
            .map((d) => {
                const deEsta = plexPorDificultad.filter((a) => a.dificultad === d);
                return `${plexIdiomas.textoDificultad(d)}: **${deEsta.filter((a) => a.completed).length}**/${deEsta.length}`;
            })
            .join(" · "),
        inline: false,
    };
}

/** Botones de la lista: página anterior y siguiente, ver u ocultar secretos y, si `reclamarTodo`, 🎁 Reclamar todo. */
function filaPaginaLogros(ownerId, targetId, { safePage, maxPage, includeHidden, filtro, reclamarTodo }) {
    // perfil_logros_{o}_{t}_{página}_{secretos}[_{filtro}]
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage - 1}_${includeHidden ? 1 : 0}${sufijoFiltro(filtro)}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage + 1}_${includeHidden ? 1 : 0}${sufijoFiltro(filtro)}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_0_${includeHidden ? 0 : 1}${sufijoFiltro(filtro)}`)
            .setLabel(includeHidden ? "🙈 Ocultar secretos" : "👁️ Ver secretos")
            .setStyle(ButtonStyle.Secondary),
    );
    if (reclamarTodo) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`perfil_reclamartodo_${ownerId}_${targetId}${sufijoFiltro(filtro)}`)
                .setLabel("🎁 Reclamar todo")
                .setStyle(ButtonStyle.Success),
        );
    }
    return row;
}

/** El botón de ocultar o enseñar los logros de Plex a los demás (solo lo ves tú, con la cuenta de Plex vinculada). */
function botonPlexOculto(ownerId, targetId, plexOculto) {
    return new ButtonBuilder()
        .setCustomId(`perfil_plexoculto_${ownerId}_${targetId}_${plexOculto ? 0 : 1}`)
        .setLabel(plexOculto ? "🍿 Enseñar mis logros de Plex" : "🍿 Ocultar mis logros de Plex")
        .setStyle(ButtonStyle.Secondary);
}

function buildLogros(guildId, ownerId, targetId, page = 0, includeHidden = false, filtro = "todos") {
    const userId = targetId;
    const propio = ownerId === targetId;
    if (!FILTROS_LOGROS[filtro]) filtro = "todos";
    // Quien oculta sus logros de Plex (lo que ve) no los enseña en su perfil a los demás; a quien no tiene Plex
    // vinculado solo le salen los de Plex que ya tenga.
    const plexOculto = plexTrofeos.oculto(guildId, userId);
    const opciones = plexTrofeos.opcionesPerfil(guildId, userId, propio);
    const todos = achievements.listUserAchievements(guildId, userId, { ...opciones, includeHidden });
    const list = todos.filter(FILTROS_LOGROS[filtro].cumple);
    const summary = achievements.getSummary(guildId, userId, opciones);
    const rarezas = list.some((a) => a.category === "plex") ? plexTrofeos.rarezas(guildId) : new Map();
    const pctImportacion = achievements.porcentajeImportacion(guildId);

    const pageSize = 6;
    const maxPage = Math.max(0, Math.ceil(list.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const slice = list.slice(start, start + pageSize);

    const desc = slice.length
        ? lineasLogros(slice, { includeHidden, pctImportacion, rarezas })
        : filtro === "todos"
          ? "No hay logros en esta vista."
          : "No hay logros con este filtro.";

    const embed = new EmbedBuilder()
        .setTitle(`${propio ? "🏅 Tus logros" : "🏅 Logros"}${filtro === "todos" ? "" : ` · ${FILTROS_LOGROS[filtro].label}`}`)
        .setDescription(desc)
        .addFields(
            { name: "Completados", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "Pendientes de reclamar", value: String(summary.claimable), inline: true },
            { name: "Página", value: `${safePage + 1}/${maxPage + 1}`, inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    const campoDificultad = campoPlexDificultad(todos, filtro);
    if (campoDificultad) embed.addFields(campoDificultad);

    const row = filaPaginaLogros(ownerId, targetId, {
        safePage,
        maxPage,
        includeHidden,
        filtro,
        reclamarTodo: propio && summary.claimable > 0,
    });
    // Solo a quien tiene la cuenta de Plex vinculada: que sus logros de Plex no se anuncien ni los vean los demás.
    if (propio && plexLinks.getLinkByDiscordId(guildId, userId)) row.addComponents(botonPlexOculto(ownerId, targetId, plexOculto));

    const components = [row];
    const menu = propio ? menuReclamar(guildId, ownerId, targetId, filtro) : null;
    if (menu) components.push(menu);
    components.push(...menusFiltroLogros(ownerId, targetId, filtro, includeHidden, todos));
    components.push(filaPestanasPerfil(ownerId, targetId, "logros"));
    return { content: "", embeds: [embed], components };
}

function menuReclamar(guildId, ownerId, targetId, filtro = "todos") {
    const userId = targetId;
    const pendientes = achievements.listUserAchievements(guildId, userId, { includeHidden: true }).filter((a) => a.claimable);
    if (!pendientes.length) return null;
    const conImportacion = achievements.porcentajeImportacion(guildId) < 100;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`perfil_reclamar_${ownerId}_${targetId}${sufijoFiltro(filtro)}`)
            .setPlaceholder(`🎁 Reclamar un logro (${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"})`)
            .addOptions(
                pendientes.slice(0, 25).map((a) => ({
                    label: a.name.slice(0, 100),
                    description: `+${achievements.rewardCoinsFor(a, guildId).toLocaleString("es")} 🪙${a.importado && conImportacion ? " (📼 de la importación)" : ""}`,
                    value: a.id,
                    emoji: a.emoji || undefined,
                })),
            ),
    );
}

module.exports = { barraLogro, CATEGORIAS, FILTROS_LOGROS, sufijoFiltro, menusFiltroLogros, buildLogros, menuReclamar };
