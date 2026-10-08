// 🍿 Fichas de Plex para los trofeos (fases 2 y 3). El historial de Tautulli no dice de qué biblioteca es cada cosa, ni
// sus géneros, ni cuántos episodios tiene cada temporada: eso sale de la ficha (get_metadata) de cada título. Aquí se
// guardan en plex_fichas:
//   - Todas las películas de las bibliotecas de películas (la lista se repasa cada 6 h): con ellas se sabe qué películas
//     de un director o de una colección hay en Plex ("todas las de Nolan", sagas).
//   - Las series que alguien ha visto, con los episodios de cada temporada (sin especiales), para saber quién ha
//     terminado una temporada o la serie entera. Las vistas hace poco se vuelven a mirar cada 3 días (episodios nuevos).
//   - Cuándo llegó a Plex cada película y cada episodio (added_at), para los trofeos sociales ("Sin spoilers").
// Se piden poco a poco (un máximo de llamadas por sincronización, primero lo que alguien ha visto), así la primera vez no
// se satura Tautulli: con una biblioteca grande tarda unas horas en estar completa.
const db = require("../core/db");
const tautulli = require("../services/tautulliClient");
const tmdbClient = require("../services/tmdbClient");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

/** Llamadas a Tautulli por sincronización (cada 30 min) y por pulsación del botón del panel. */
const PRESUPUESTO = { cron: 300, boton: 1200 };
/** Películas cuyos países se piden a TMDB por sincronización (una llamada cada una). */
const PRESUPUESTO_PAISES = 60;
const EN_PARALELO = 4;
const PAGINA_BIBLIOTECA = 2000;
const MAX_PAGINAS_BIBLIOTECA = 100;
const HORA = 3600 * 1000;
const DIA = 24 * HORA;
const REVISAR_BIBLIOTECA = 6 * HORA;
const REFRESCAR_SERIE = 3 * DIA; // si se ha visto en los últimos 30 días
const REFRESCAR_PELICULA = 30 * DIA;
const REINTENTAR_PERDIDA = 7 * DIA;
// Si Tautulli falla tantas veces seguidas, se deja para la siguiente sincronización.
const MAX_ERRORES_SEGUIDOS = 5;

const normalizar = (s) =>
    String(s ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
/** La misma película aunque esté en dos bibliotecas (la normal y la 4K) o se haya vuelto a añadir con otra clave. */
const clavePelicula = (titulo, anio) => `${normalizar(titulo)}|${Number(anio) || ""}`;
const etiquetas = (v) =>
    Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === "string" ? x : x?.tag || x?.title || "")).filter(Boolean))] : [];
const leerJson = (v, porDefecto) => {
    try {
        return v ? JSON.parse(v) : porDefecto;
    } catch {
        return porDefecto;
    }
};

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

function guardarPerdida(guildId, key) {
    db.prepare("UPDATE plex_fichas SET encontrada = 0, actualizada = ? WHERE guildId = ? AND rating_key = ?").run(Date.now(), guildId, key);
}

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

/** Cuándo llegó a Plex (added_at de Tautulli, unix en segundos), o null si no lo dice. */
const alta = (m) => (Number(m?.added_at) > 0 ? Number(m.added_at) : null);

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

/** Repasa la lista de películas de cada biblioteca de películas: apunta las nuevas y marca las que ya no están. */
async function revisarBiblioteca(guildId, pedir) {
    const libs = await pedir(() => bibliotecas(guildId));
    const insertar = db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, actualizada)
         VALUES (?, ?, 'movie', ?, ?, ?, ?, 0)
         ON CONFLICT(guildId, rating_key) DO UPDATE SET section_id = excluded.section_id, biblioteca = excluded.biblioteca,
             encontrada = CASE WHEN plex_fichas.encontrada = 0 THEN 1 ELSE plex_fichas.encontrada END,
             actualizada = CASE WHEN plex_fichas.encontrada = 0 THEN 0 ELSE plex_fichas.actualizada END`,
    );
    let nuevas = 0;
    for (const lib of libs.filter((l) => l.tipo === "movie")) {
        const presentes = new Set();
        for (let pagina = 0; pagina < MAX_PAGINAS_BIBLIOTECA; pagina++) {
            const start = pagina * PAGINA_BIBLIOTECA;
            const { filas } = await pedir(() => tautulli.getLibraryMediaInfo(guildId, lib.id, { start, length: PAGINA_BIBLIOTECA }));
            const antesDeLaPagina = presentes.size;
            db.transaction(() => {
                for (const f of filas) {
                    if (!f.rating_key) continue;
                    const key = String(f.rating_key);
                    presentes.add(key);
                    const antes = db.prepare("SELECT 1 FROM plex_fichas WHERE guildId = ? AND rating_key = ?").get(guildId, key);
                    insertar.run(guildId, key, f.title || null, Number(f.year) || null, lib.id, lib.nombre);
                    if (!antes) nuevas++;
                }
            })();
            // Página incompleta (la última), o Tautulli no pagina y devuelve siempre lo mismo: se acabó.
            if (filas.length !== PAGINA_BIBLIOTECA || presentes.size === antesDeLaPagina) break;
        }
        // Una lista vacía de una biblioteca que tiene películas es un fallo de Tautulli, no que se hayan borrado todas.
        if (!presentes.size && lib.items > 0) {
            log.warn(`La biblioteca ${lib.nombre} (${lib.id}) tiene ${lib.items} películas pero Tautulli no ha devuelto ninguna`);
            continue;
        }
        // Las que ya no están en esa biblioteca dejan de contar para "todas las de…".
        const guardadas = db
            .prepare("SELECT rating_key FROM plex_fichas WHERE guildId = ? AND tipo = 'movie' AND section_id = ? AND encontrada = 1")
            .pluck()
            .all(guildId, lib.id);
        const quitar = db.prepare("UPDATE plex_fichas SET encontrada = 0 WHERE guildId = ? AND rating_key = ?");
        db.transaction(() => guardadas.filter((k) => !presentes.has(k)).forEach((k) => quitar.run(guildId, k)))();
    }
    db.prepare(
        `INSERT INTO plex_sync (guildId, ultimo_inicio, biblioteca_revisada) VALUES (?, 0, ?)
         ON CONFLICT(guildId) DO UPDATE SET biblioteca_revisada = excluded.biblioteca_revisada`,
    ).run(guildId, Date.now());
    return nuevas;
}

/** Lo que falta por pedir, en orden: series vistas sin ficha, películas sin ficha (las vistas primero), series vistas
 * hace poco con la ficha vieja, películas con la ficha vieja y las series que no se encontraron hace tiempo (las
 * películas que ya no están vuelven solas al repasar la biblioteca si se añaden otra vez). */
function cola(guildId) {
    const ahora = Date.now();
    // Series vistas que todavía no tienen ficha.
    db.prepare(
        `INSERT OR IGNORE INTO plex_fichas (guildId, rating_key, tipo, titulo, actualizada)
         SELECT guildId, serie_key, 'show', MAX(serie), 0 FROM plex_reproducciones
         WHERE guildId = ? AND tipo = 'episode' AND serie_key IS NOT NULL GROUP BY serie_key`,
    ).run(guildId);
    const pendientes = db
        .prepare("SELECT rating_key, tipo, titulo, anio FROM plex_fichas WHERE guildId = ? AND actualizada = 0 AND encontrada = 1")
        .all(guildId);
    const vistas = db
        .prepare("SELECT DISTINCT rating_key, titulo, anio FROM plex_reproducciones WHERE guildId = ? AND tipo = 'movie'")
        .all(guildId);
    const keysVistas = new Set(vistas.map((v) => v.rating_key));
    const titulosVistos = new Set(vistas.map((v) => clavePelicula(v.titulo, v.anio)));
    const vista = (f) => keysVistas.has(f.rating_key) || titulosVistos.has(clavePelicula(f.titulo, f.anio));
    const series = pendientes.filter((f) => f.tipo === "show");
    const peliculas = pendientes.filter((f) => f.tipo === "movie").sort((a, b) => Number(vista(b)) - Number(vista(a)));
    // Series vistas hace poco con la ficha de hace más de 3 días, y las que se quedaron sin temporadas (Tautulli no las
    // dio) de hace más de un día.
    const seriesViejas = db
        .prepare(
            `SELECT rating_key, tipo FROM plex_fichas f WHERE guildId = ? AND tipo = 'show' AND encontrada = 1 AND actualizada > 0
                 AND ((actualizada < ? AND EXISTS (SELECT 1 FROM plex_reproducciones r WHERE r.guildId = f.guildId AND r.serie_key = f.rating_key AND r.inicio > ?))
                      OR (COALESCE(temporadas, '{}') = '{}' AND actualizada < ?))
             ORDER BY actualizada`,
        )
        .all(guildId, ahora - REFRESCAR_SERIE, Math.floor((ahora - 30 * DIA) / 1000), ahora - DIA);
    const viejas = db
        .prepare(
            `SELECT rating_key, tipo FROM plex_fichas WHERE guildId = ? AND actualizada > 0
                 AND ((tipo = 'movie' AND encontrada = 1 AND actualizada < ?) OR (tipo = 'show' AND encontrada = 0 AND actualizada < ?))
             ORDER BY actualizada LIMIT 500`,
        )
        .all(guildId, ahora - REFRESCAR_PELICULA, ahora - REINTENTAR_PERDIDA);
    return [...series, ...peliculas, ...seriesViejas, ...viejas];
}

/**
 * Pide a TMDB los países de las películas que tienen su id de TMDB y aún no los tienen (sin clave, no hace nada).
 * Un error de TMDB para la película: se deja para la siguiente vez.
 * @returns {Promise<number>} cuántas películas se han completado
 */
async function completarPaises(guildId, { presupuesto = PRESUPUESTO_PAISES } = {}) {
    if (!process.env.TMDB_API_KEY) return 0;
    const pendientes = db
        .prepare(
            "SELECT rating_key, tmdb FROM plex_fichas WHERE guildId = ? AND tipo = 'movie' AND tmdb IS NOT NULL AND paises IS NULL AND encontrada = 1 LIMIT ?",
        )
        .all(guildId, presupuesto);
    let completadas = 0;
    for (const f of pendientes) {
        try {
            const paises = await tmdbClient.paisesDePelicula(f.tmdb);
            if (!paises) return completadas;
            db.prepare("UPDATE plex_fichas SET paises = ? WHERE guildId = ? AND rating_key = ?").run(
                JSON.stringify(paises),
                guildId,
                f.rating_key,
            );
            completadas++;
        } catch (e) {
            log.warn(`No se pudieron pedir los países de la película ${f.tmdb} a TMDB: ${e.message}`);
            break;
        }
    }
    return completadas;
}

/**
 * Pide a Tautulli las fichas que faltan o están viejas, sin pasarse de `presupuesto` llamadas.
 * @returns {Promise<{ llamadas: number, fichas: number, nuevasEnBiblioteca: number, errores: number, pendientes: number }>}
 */
async function actualizar(guildId, { presupuesto = PRESUPUESTO.cron } = {}) {
    const t0 = Date.now();
    const r = { llamadas: 0, fichas: 0, nuevasEnBiblioteca: 0, errores: 0, pendientes: 0 };
    let erroresSeguidos = 0;
    const pedir = async (fn) => {
        r.llamadas++;
        const v = await fn();
        erroresSeguidos = 0;
        return v;
    };

    const sync = db.prepare("SELECT biblioteca_revisada FROM plex_sync WHERE guildId = ?").get(guildId);
    if (!sync?.biblioteca_revisada || Date.now() - sync.biblioteca_revisada > REVISAR_BIBLIOTECA) {
        try {
            r.nuevasEnBiblioteca = await revisarBiblioteca(guildId, pedir);
        } catch (e) {
            r.errores++;
            log.warn(`No se pudo repasar la biblioteca de películas de ${guildId}: ${e.message}`);
        }
    }

    const lista = cola(guildId);
    // Si Plex no responde, Tautulli da cada ficha por perdida: antes de marcar nada, una que seguro que existe.
    if (lista.length && r.llamadas < presupuesto) {
        const conocida = db
            .prepare(
                "SELECT rating_key FROM plex_fichas WHERE guildId = ? AND tipo = 'movie' AND encontrada = 1 AND actualizada > 0 ORDER BY actualizada DESC LIMIT 1",
            )
            .pluck()
            .get(guildId);
        if (conocida) {
            let ok = false;
            try {
                ok = Boolean(await pedir(() => tautulli.getMetadata(guildId, conocida)));
            } catch (e) {
                log.debug(`Comprobación de Plex: ${e.message}`);
            }
            if (!ok) {
                r.errores++;
                r.pendientes = estado(guildId).pendientes;
                log.warn(
                    `Fichas de Plex de ${guildId}: Plex no da la ficha de una película que sí está; se deja para la próxima sincronización`,
                );
                return r;
            }
        }
    }
    let i = 0;
    const trabajador = async () => {
        while (i < lista.length && r.llamadas < presupuesto && erroresSeguidos < MAX_ERRORES_SEGUIDOS) {
            const f = lista[i++];
            try {
                await (f.tipo === "show" ? fichaSerie : fichaPelicula)(guildId, f.rating_key, pedir);
                r.fichas++;
            } catch (e) {
                r.errores++;
                erroresSeguidos++;
                log.debug(`Ficha de ${f.tipo} ${f.rating_key}: ${e.message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
    if (erroresSeguidos >= MAX_ERRORES_SEGUIDOS)
        log.warn(`Fichas de Plex de ${guildId}: Tautulli falla, se sigue en la próxima sincronización`);

    r.pendientes = estado(guildId).pendientes;
    (r.fichas || r.nuevasEnBiblioteca ? log.info : log.debug)(
        `Fichas de Plex de ${guildId}: ${r.fichas} actualizadas, ${r.nuevasEnBiblioteca} películas nuevas en la biblioteca, ` +
            `${r.pendientes} pendientes · ${r.llamadas} llamadas · ${Date.now() - t0} ms`,
    );
    try {
        r.paises = await completarPaises(guildId);
    } catch (e) {
        log.warn(`No se pudieron completar los países de las películas de ${guildId}: ${e.message}`);
    }
    return r;
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
    const filas = db.prepare("SELECT * FROM plex_fichas WHERE guildId = ? AND actualizada > 0").all(guildId);
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

module.exports = {
    PRESUPUESTO,
    completarPaises,
    tmdbDe,
    actualizar,
    estado,
    cargar,
    bibliotecas,
    nombresBibliotecas,
    configAnime,
    esAnime,
    normalizar,
    clavePelicula,
};
