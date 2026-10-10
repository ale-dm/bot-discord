// Sincronización de las fichas de Plex con Tautulli: repasar la lista de películas de cada biblioteca, elegir qué fichas
// faltan o están viejas (sin pasarse de un presupuesto de llamadas) y pedir los países de las películas a TMDB.
const db = require("../../core/db");
const tautulli = require("../../services/tautulliClient");
const tmdbClient = require("../../services/tmdbClient");
const { createLogger } = require("../../core/logger");
const { clavePelicula, estado } = require("./consulta");
const { bibliotecas, fichaPelicula, fichaSerie } = require("./tautulli");

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
            const existeFicha = db.prepare("SELECT 1 FROM plex_fichas WHERE guildId = ? AND rating_key = ?");
            db.transaction(() => {
                for (const f of filas) {
                    if (!f.rating_key) continue;
                    const key = String(f.rating_key);
                    presentes.add(key);
                    const antes = existeFicha.get(guildId, key);
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

/** Repasa la biblioteca de películas si nunca se ha repasado o hace más de REVISAR_BIBLIOTECA. */
async function repasarSiToca(guildId, pedir, r) {
    const sync = db.prepare("SELECT biblioteca_revisada FROM plex_sync WHERE guildId = ?").get(guildId);
    if (!sync?.biblioteca_revisada || Date.now() - sync.biblioteca_revisada > REVISAR_BIBLIOTECA) {
        try {
            r.nuevasEnBiblioteca = await revisarBiblioteca(guildId, pedir);
        } catch (e) {
            r.errores++;
            log.warn(`No se pudo repasar la biblioteca de películas de ${guildId}: ${e.message}`);
        }
    }
}

/**
 * Si Plex no responde, Tautulli da cada ficha por perdida: antes de marcar nada, pide una película que seguro que existe.
 * @returns {Promise<boolean>} false si esa ficha no llega (la sincronización se deja para la siguiente vez)
 */
async function plexResponde(guildId, pedir, r) {
    const conocida = db
        .prepare(
            "SELECT rating_key FROM plex_fichas WHERE guildId = ? AND tipo = 'movie' AND encontrada = 1 AND actualizada > 0 ORDER BY actualizada DESC LIMIT 1",
        )
        .pluck()
        .get(guildId);
    if (!conocida) return true;
    let ok = false;
    try {
        ok = Boolean(await pedir(() => tautulli.getMetadata(guildId, conocida)));
    } catch (e) {
        log.debug(`Comprobación de Plex: ${e.message}`);
    }
    if (ok) return true;
    r.errores++;
    r.pendientes = estado(guildId).pendientes;
    log.warn(`Fichas de Plex de ${guildId}: Plex no da la ficha de una película que sí está; se deja para la próxima sincronización`);
    return false;
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

    await repasarSiToca(guildId, pedir, r);

    const lista = cola(guildId);
    if (lista.length && r.llamadas < presupuesto && !(await plexResponde(guildId, pedir, r))) return r;
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

module.exports = { PRESUPUESTO, completarPaises, actualizar };
