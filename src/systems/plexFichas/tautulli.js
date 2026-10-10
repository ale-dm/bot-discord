// Las fichas de Plex que salen de Tautulli: la lista de bibliotecas y la ficha (get_metadata) de cada película y serie.
const db = require("../../core/db");
const tautulli = require("../../services/tautulliClient");

/** Las bibliotecas de Tautulli: [{ id, nombre, tipo }] (tipo: movie, show, artist...). */
async function bibliotecas(guildId) {
    const libs = await tautulli.getLibraries(guildId);
    return libs.map((l) => ({
        id: String(l.section_id),
        nombre: l.section_name || "",
        tipo: l.section_type || "",
        items: Number(l.count) || 0,
    }));
}

const etiquetas = (v) =>
    Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === "string" ? x : x?.tag || x?.title || "")).filter(Boolean))] : [];

/** Cuándo llegó a Plex (added_at de Tautulli, unix en segundos), o null si no lo dice. */
const alta = (m) => (Number(m?.added_at) > 0 ? Number(m.added_at) : null);

/** El id de TMDB de una película, si Tautulli lo da en sus guids ("tmdb://603"). */
function tmdbDe(m) {
    const guids = [...(Array.isArray(m.guids) ? m.guids : []), m.guid].map((g) => String(g || ""));
    const hallado = guids.map((g) => /tmdb:\/\/(\d+)/.exec(g)).find(Boolean);
    return hallado ? hallado[1] : null;
}

function datosComunes(m) {
    return {
        titulo: m.title || null,
        anio: Number(m.year) || null,
        section_id: m.section_id !== undefined && m.section_id !== null ? String(m.section_id) : null,
        biblioteca: m.library_name || null,
        generos: JSON.stringify(etiquetas(m.genres)),
    };
}

function guardarPerdida(guildId, key) {
    db.prepare("UPDATE plex_fichas SET encontrada = 0, actualizada = ? WHERE guildId = ? AND rating_key = ?").run(Date.now(), guildId, key);
}

async function fichaPelicula(guildId, key, pedir) {
    const m = await pedir(() => tautulli.getMetadata(guildId, key));
    if (!m) return guardarPerdida(guildId, key);
    db.prepare(
        `UPDATE plex_fichas SET titulo = COALESCE(@titulo, titulo), anio = COALESCE(@anio, anio), section_id = COALESCE(@section_id, section_id),
                biblioteca = COALESCE(@biblioteca, biblioteca), generos = @generos, directores = @directores, colecciones = @colecciones,
                tmdb = COALESCE(@tmdb, tmdb), alta = COALESCE(@alta, alta), encontrada = 1, actualizada = @ahora
         WHERE guildId = @guildId AND rating_key = @key`,
    ).run({
        ...datosComunes(m),
        directores: JSON.stringify(etiquetas(m.directors)),
        colecciones: JSON.stringify(etiquetas(m.collections)),
        tmdb: tmdbDe(m),
        alta: alta(m),
        ahora: Date.now(),
        guildId,
        key,
    });
}

async function fichaSerie(guildId, key, pedir) {
    const m = await pedir(() => tautulli.getMetadata(guildId, key));
    if (!m) return guardarPerdida(guildId, key);
    const temporadas = {};
    // Cuándo llegó a Plex cada episodio ("temporada:episodio" → unix), para los trofeos sociales.
    const altas = {};
    const hijas = await pedir(() => tautulli.getChildrenMetadata(guildId, key, "show"));
    for (const t of hijas) {
        const n = Number(t.media_index);
        if (!(n > 0) || !t.rating_key) continue; // la temporada 0 son los especiales
        const episodios = await pedir(() => tautulli.getChildrenMetadata(guildId, t.rating_key, "season"));
        const numeros = [...new Set(episodios.map((e) => Number(e.media_index)).filter((x) => x > 0))].sort((a, b) => a - b);
        if (numeros.length) temporadas[n] = numeros;
        for (const e of episodios) if (Number(e.media_index) > 0 && alta(e)) altas[`${n}:${Number(e.media_index)}`] = alta(e);
    }
    db.prepare(
        `UPDATE plex_fichas SET titulo = COALESCE(@titulo, titulo), anio = COALESCE(@anio, anio), section_id = COALESCE(@section_id, section_id),
                biblioteca = COALESCE(@biblioteca, biblioteca), generos = @generos, colecciones = @colecciones, temporadas = @temporadas,
                altas = @altas, encontrada = 1, actualizada = @ahora
         WHERE guildId = @guildId AND rating_key = @key`,
    ).run({
        ...datosComunes(m),
        colecciones: JSON.stringify(etiquetas(m.collections)),
        temporadas: JSON.stringify(temporadas),
        altas: JSON.stringify(altas),
        ahora: Date.now(),
        guildId,
        key,
    });
}

module.exports = { bibliotecas, tmdbDe, fichaPelicula, fichaSerie };
