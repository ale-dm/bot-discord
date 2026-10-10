// Consultas sobre las fichas de Plex ya guardadas (plex_fichas): el estado de la sincronización, las fichas de cada
// servidor con sus listas leídas, y qué cuenta como anime. No llama a Tautulli.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");

const normalizar = (s) =>
    String(s ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
/** La misma película aunque esté en dos bibliotecas (la normal y la 4K) o se haya vuelto a añadir con otra clave. */
const clavePelicula = (titulo, anio) => `${normalizar(titulo)}|${Number(anio) || ""}`;
const leerJson = (v, porDefecto) => {
    try {
        return v ? JSON.parse(v) : porDefecto;
    } catch {
        return porDefecto;
    }
};

/**
 * Qué cuenta como anime: las bibliotecas elegidas en Panel admin → Plex → 🏆 Trofeos (plex.bibliotecas_anime, ids
 * separados por comas) o, si no se ha elegido ninguna, las bibliotecas con "anime" en el nombre y lo que tenga el
 * género Anime.
 */
function configAnime(guildId) {
    const ids = String(guildSettings.getSettings(guildId).plex.bibliotecas_anime || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return { ids: new Set(ids), auto: !ids.length };
}

function esAnime(ficha, cfg) {
    if (!cfg.auto) return cfg.ids.has(String(ficha.section_id));
    return /anime/i.test(ficha.biblioteca || "") || (ficha.generos || []).some((g) => normalizar(g) === "anime");
}

/** Cuántas fichas hay y cuántas faltan (para el panel y para saber si ya se conoce la biblioteca entera). */
function estado(guildId) {
    const c = db
        .prepare(
            `SELECT COALESCE(SUM(tipo = 'movie' AND encontrada = 1), 0) AS peliculas,
                    COALESCE(SUM(tipo = 'show' AND encontrada = 1), 0) AS series,
                    COALESCE(SUM(actualizada = 0 AND encontrada = 1), 0) AS pendientes,
                    COALESCE(SUM(tipo = 'movie' AND actualizada = 0 AND encontrada = 1), 0) AS peliculasPendientes,
                    COALESCE(SUM(encontrada = 0), 0) AS perdidas
             FROM plex_fichas WHERE guildId = ?`,
        )
        .get(guildId);
    const revisada = db.prepare("SELECT biblioteca_revisada FROM plex_sync WHERE guildId = ?").get(guildId)?.biblioteca_revisada || null;
    // "Completa": se ha repasado la biblioteca y no falta ninguna película (hace falta para "todas las de…" y las sagas).
    return { ...c, bibliotecaRevisada: revisada, completa: Boolean(revisada) && c.peliculasPendientes === 0 };
}

/** id → nombre de las bibliotecas que salen en las fichas (para el panel, sin preguntar a Tautulli). */
function nombresBibliotecas(guildId) {
    const filas = db
        .prepare(
            "SELECT DISTINCT section_id, biblioteca FROM plex_fichas WHERE guildId = ? AND section_id IS NOT NULL AND biblioteca IS NOT NULL",
        )
        .all(guildId);
    return new Map(filas.map((f) => [String(f.section_id), f.biblioteca]));
}

/** Todas las fichas ya pedidas de un servidor, con las listas en JSON ya leídas. */
function cargar(guildId) {
    const filas = db
        .prepare(
            "SELECT guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, temporadas, encontrada, actualizada, alta, altas, tmdb, paises FROM plex_fichas WHERE guildId = ? AND actualizada > 0",
        )
        .all(guildId);
    const fichas = filas.map((f) => ({
        ...f,
        encontrada: Boolean(f.encontrada),
        generos: leerJson(f.generos, []),
        directores: leerJson(f.directores, []),
        colecciones: leerJson(f.colecciones, []),
        paises: leerJson(f.paises, []),
        temporadas: leerJson(f.temporadas, null),
        altas: leerJson(f.altas, {}),
    }));
    return {
        peliculas: fichas.filter((f) => f.tipo === "movie"),
        series: fichas.filter((f) => f.tipo === "show"),
        completa: estado(guildId).completa,
    };
}

module.exports = { normalizar, clavePelicula, configAnime, esAnime, estado, nombresBibliotecas, cargar };
