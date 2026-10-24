// 🎲 Ruleta de películas (#576): el «no sé qué ver». Una película al azar de la biblioteca de Plex que la persona no ha
// visto, con filtros opcionales (género, década y duración máxima). Sale solo de la BD: las películas que el repaso de
// la biblioteca (get_library_media_info) y las fichas (get_metadata) han dejado en plex_fichas, y lo que ha visto según
// plex_reproducciones y su vínculo de plexLinks. Ninguna tirada llama a Tautulli. El azar se inyecta (`azar`) para los
// tests. Sin Discord: la pantalla está en paneles/plexRuleta.js.
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const { clavePelicula } = require("./plexFichas");
const { canonico, slug } = require("./plexTrofeos/base");

/** Las duraciones máximas que se pueden elegir, en minutos. */
const DURACIONES = [90, 120, 150];
/** Opciones de cada menú de filtros, sin contar «todos»: 24 + 1 = 25, el máximo de Discord. */
const MAX_OPCIONES = 24;
const SIN_FILTROS = Object.freeze({ genero: "", decada: 0, duracion: 0 });

const leerLista = (v) => {
    try {
        const x = JSON.parse(v || "[]");
        return Array.isArray(x) ? x.filter((g) => typeof g === "string" && g) : [];
    } catch {
        return [];
    }
};
/** El id de un género para los filtros: el mismo para «Terror» y «Horror» (como los trofeos). */
const generoId = (g) => slug(canonico(g));
const decadaDe = (anio) => (anio ? Math.floor(anio / 10) * 10 : 0);

/** Filtros válidos a partir de lo que llega (de un customId o de un menú): lo que no se entiende, fuera. */
function normalizarFiltros(f = {}) {
    const genero = String(f.genero || "");
    const decada = Number(f.decada) || 0;
    const duracion = Number(f.duracion) || 0;
    return {
        genero: /^[a-z0-9-]{1,50}$/.test(genero) ? genero : "",
        decada: Number.isInteger(decada) && decada >= 1880 && decada <= 2100 && decada % 10 === 0 ? decada : 0,
        duracion: DURACIONES.includes(duracion) ? duracion : 0,
    };
}

/**
 * Las películas que hay ahora en Plex, una vez por título y año (la misma en dos bibliotecas, la normal y la 4K, cuenta
 * una vez: la que ya tiene ficha). Las que el repaso de la biblioteca ya conoce pero aún no tienen ficha también salen,
 * sin géneros: solo pasan cuando no se filtra por género.
 * `duracion` (minutos, migración 078) es null en las fichas pedidas antes de guardarla: se rellena al refrescarlas.
 */
function peliculasDePlex(guildId) {
    const filas = db
        .prepare(
            `SELECT rating_key, titulo, anio, biblioteca, generos, directores, tmdb, duracion, actualizada FROM plex_fichas
             WHERE guildId = ? AND tipo = 'movie' AND encontrada = 1 AND titulo IS NOT NULL ORDER BY rating_key`,
        )
        .all(guildId);
    const porClave = new Map();
    for (const f of filas) {
        const p = {
            ratingKey: String(f.rating_key),
            clave: clavePelicula(f.titulo, f.anio),
            titulo: f.titulo,
            anio: Number(f.anio) || null,
            biblioteca: f.biblioteca || null,
            generos: leerLista(f.generos),
            directores: leerLista(f.directores),
            tmdb: Number(f.tmdb) > 0 ? Number(f.tmdb) : null,
            conFicha: f.actualizada > 0,
            duracion: Number(f.duracion) > 0 ? Number(f.duracion) : null,
        };
        const antes = porClave.get(p.clave);
        if (!antes || (!antes.conFicha && p.conFicha)) porClave.set(p.clave, p);
    }
    return [...porClave.values()];
}

/** Lo que ha visto (Tautulli lo da por visto), por clave de Plex y por título y año (otra copia de la misma película). */
function vistasDe(guildId, tautulliUserId) {
    const filas = db
        .prepare(
            "SELECT DISTINCT rating_key, titulo, anio FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'movie' AND visto = 1",
        )
        .all(guildId, String(tautulliUserId));
    return {
        keys: new Set(filas.filter((f) => f.rating_key).map((f) => String(f.rating_key))),
        claves: new Set(filas.filter((f) => f.titulo).map((f) => clavePelicula(f.titulo, f.anio))),
    };
}

/** ¿Pasa los filtros? `salvo` deja fuera uno (para saber qué opciones de ese menú dan algo con los demás). */
function cumple(p, f, salvo = null) {
    if (salvo !== "genero" && f.genero && !p.generos.some((g) => generoId(g) === f.genero)) return false;
    if (salvo !== "decada" && f.decada && decadaDe(p.anio) !== f.decada) return false;
    if (salvo !== "duracion" && f.duracion && !(p.duracion && p.duracion <= f.duracion)) return false;
    return true;
}

/** Las opciones de cada menú: los géneros (los más frecuentes) y las décadas que hay sin ver con los otros filtros. */
function facetas(sinVer, f) {
    const generos = new Map();
    for (const p of sinVer.filter((x) => cumple(x, f, "genero"))) {
        // Una vez por película aunque tenga el mismo género en dos idiomas.
        for (const [id, nombre] of new Map(p.generos.map((g) => [generoId(g), g]))) {
            if (!generos.has(id)) generos.set(id, { id, nombre, n: 0 });
            generos.get(id).n++;
        }
    }
    const listaGeneros = [...generos.values()].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es")).slice(0, MAX_OPCIONES);
    // El elegido siempre sale en el menú, aunque con los otros filtros ya no dé nada.
    if (f.genero && !listaGeneros.some((g) => g.id === f.genero)) listaGeneros.push({ id: f.genero, nombre: f.genero, n: 0 });
    const decadas = new Map();
    for (const p of sinVer.filter((x) => cumple(x, f, "decada") && x.anio))
        decadas.set(decadaDe(p.anio), (decadas.get(decadaDe(p.anio)) || 0) + 1);
    if (f.decada && !decadas.has(f.decada)) decadas.set(f.decada, 0);
    const listaDecadas = [...decadas.entries()]
        .map(([decada, n]) => ({ decada, n }))
        .sort((a, b) => b.decada - a.decada)
        .slice(0, MAX_OPCIONES);
    const duraciones = sinVer.some((p) => p.duracion) ? DURACIONES : [];
    return { generos: listaGeneros, decadas: listaDecadas, duraciones };
}

/**
 * Una tirada: una película de Plex que la persona no ha visto y que pasa los filtros.
 * - `anterior`: la clave de Plex de la que estaba en pantalla; 🎬 Otra no la repite (si es la única, sale con `unica`).
 * - `fijar`: enseña esa película si sigue sin ver (para repintar la ficha tras 📝 Quiero ver).
 * @returns {{ ok: false, motivo: string } | { ok: true, filtros, facetas, total: number, pelicula: object|null, unica: boolean }}
 */
function tirar(guildId, userId, { filtros = SIN_FILTROS, anterior = null, fijar = null, azar = Math.random } = {}) {
    const f = normalizarFiltros(filtros);
    const link = plexLinks.getLinkByDiscordId(guildId, String(userId));
    if (!link)
        return {
            ok: false,
            motivo: "Tu cuenta de Plex no está vinculada: sin ella no sé qué has visto. Pídele a un admin que te vincule.",
        };
    const todas = peliculasDePlex(guildId);
    if (!todas.length)
        return { ok: false, motivo: "Todavía no conozco las películas de Plex: salen cuando se sincroniza la biblioteca (cada 30 min)." };
    const { keys, claves } = vistasDe(guildId, link.tautulliUserId);
    const sinVer = todas.filter((p) => !keys.has(p.ratingKey) && !claves.has(p.clave));
    if (!sinVer.length) return { ok: false, motivo: "Has visto todas las películas que hay en Plex. ¡Pide alguna en 🍿 Seerr!" };
    const pasan = sinVer.filter((p) => cumple(p, f));
    const base = { ok: true, filtros: f, facetas: facetas(sinVer, f), total: pasan.length, pelicula: null, unica: false };
    if (!pasan.length) return base;
    const fijada = fijar ? pasan.find((p) => p.ratingKey === String(fijar)) : null;
    if (fijada) return { ...base, pelicula: fijada };
    const otras = anterior ? pasan.filter((p) => p.ratingKey !== String(anterior)) : pasan;
    if (!otras.length) return { ...base, pelicula: pasan[0], unica: true };
    const i = Math.min(otras.length - 1, Math.max(0, Math.floor(Number(azar()) * otras.length) || 0));
    return { ...base, pelicula: otras[i] };
}

module.exports = { DURACIONES, MAX_OPCIONES, SIN_FILTROS, normalizarFiltros, generoId, cumple, facetas, peliculasDePlex, tirar };
