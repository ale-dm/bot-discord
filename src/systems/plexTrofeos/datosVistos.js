// Lo que ha visto cada persona en Plex, cruzado con las fichas: el contexto común de una evaluación de trofeos y los
// datos de un usuario (películas, series, géneros, décadas, países e idiomas).
const db = require("../../core/db");
const plexFichas = require("../plexFichas");
const plexIdiomas = require("../plexIdiomas");
const { slug, canonico, normalizar, clavePelicula } = require("./base");

// ─── Lo que ha visto cada uno ────────────────────────────────────────────────
/** Lo que es igual para todos en una evaluación: las fichas, qué es anime, directores y sagas de la biblioteca. */
function contexto(guildId) {
    const { peliculas, series, completa } = plexFichas.cargar(guildId);
    const anime = plexFichas.configAnime(guildId);
    const peliculasPorKey = new Map(peliculas.map((p) => [p.rating_key, p]));
    const peliculasPorTitulo = new Map();
    for (const p of peliculas)
        if (p.encontrada || !peliculasPorTitulo.has(clavePelicula(p.titulo, p.anio)))
            peliculasPorTitulo.set(clavePelicula(p.titulo, p.anio), p);
    const seriesPorKey = new Map(series.filter((s) => s.temporadas).map((s) => [s.rating_key, s]));
    const seriesPorTitulo = new Map();
    for (const s of series)
        if (s.temporadas && (s.encontrada || !seriesPorTitulo.has(normalizar(s.titulo)))) seriesPorTitulo.set(normalizar(s.titulo), s);

    // Directores y sagas: con las películas que hay ahora en Plex, una vez por título (aunque esté en dos bibliotecas).
    const directores = new Map();
    const sagas = new Map();
    const apuntar = (mapa, nombre, p) => {
        const k = slug(nombre);
        if (!mapa.has(k)) mapa.set(k, { nombre, peliculas: new Map() });
        mapa.get(k).peliculas.set(clavePelicula(p.titulo, p.anio), p);
    };
    for (const p of peliculas.filter((x) => x.encontrada)) {
        p.directores.forEach((d) => apuntar(directores, d, p));
        p.colecciones.forEach((c) => apuntar(sagas, c, p));
    }
    return { completa, anime, peliculas, peliculasPorKey, peliculasPorTitulo, seriesPorKey, seriesPorTitulo, directores, sagas };
}

/** Películas vistas entre `desde` y `hasta` (unix, s): las que tienen ficha, y en qué idiomas se vieron (plexIdiomas.MODOS). */
function peliculasVistas(guildId, tautulliUserId, ctx, desde, hasta) {
    const pelis = db
        .prepare(
            `SELECT DISTINCT rating_key, titulo, anio, audio, subs FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'movie' AND visto = 1 AND inicio >= ? AND inicio < ?`,
        )
        .all(guildId, String(tautulliUserId), desde, hasta);
    const vistas = new Set();
    const fichasVistas = new Map();
    const pelisPorModo = new Map(Object.keys(plexIdiomas.MODOS).map((m) => [m, new Set()]));
    for (const r of pelis) {
        vistas.add(clavePelicula(r.titulo, r.anio));
        const f = ctx.peliculasPorKey.get(r.rating_key) || ctx.peliculasPorTitulo.get(clavePelicula(r.titulo, r.anio));
        // La película, una vez aunque se viera varias veces (y en varios idiomas: cuenta en cada uno).
        const clave = f ? clavePelicula(f.titulo, f.anio) : clavePelicula(r.titulo, r.anio);
        for (const m of plexIdiomas.modosDe(r.audio, r.subs, f ? plexFichas.esAnime(f, ctx.anime) : false)) pelisPorModo.get(m).add(clave);
        if (!f) continue;
        vistas.add(clave);
        fichasVistas.set(clave, f);
    }
    return { vistas, fichasVistas, pelisPorModo };
}

/** Géneros, países y décadas de las películas vistas (una vez por película), y cuántas son de anime. */
function resumenPeliculas(fichasVistas, cfgAnime) {
    const porGenero = new Map();
    const porDecada = new Map();
    const porPais = new Map();
    let animePeliculas = 0;
    for (const f of fichasVistas.values()) {
        if (plexFichas.esAnime(f, cfgAnime)) animePeliculas++;
        // Una vez por película aunque tenga el mismo género en dos idiomas ("Terror" y "Horror").
        const generos = new Map(f.generos.map((g) => [canonico(g), g]));
        for (const [k, g] of generos) {
            if (!porGenero.has(k)) porGenero.set(k, { nombre: g, n: 0 });
            porGenero.get(k).n++;
        }
        // Los países de producción de la película (TMDB), una vez por película.
        const paises = new Map((f.paises || []).map((p) => [normalizar(p), p]));
        for (const [k, p] of paises) {
            if (!porPais.has(k)) porPais.set(k, { nombre: p, n: 0 });
            porPais.get(k).n++;
        }
        if (f.anio) {
            const d = Math.floor(f.anio / 10) * 10;
            porDecada.set(d, (porDecada.get(d) || 0) + 1);
        }
    }
    return { porGenero, porDecada, porPais, animePeliculas };
}

/** Episodios vistos entre `desde` y `hasta`, agrupados por la ficha de su serie (la de su clave o la del mismo título). */
function seriesVistas(guildId, tautulliUserId, ctx, desde, hasta) {
    // Episodios vistos de cada serie: la de su clave o, si esa ya no está (se volvió a añadir con otra), la que tenga el
    // mismo título; así lo visto antes y después de volver a añadirla cuenta junto.
    const eps = db
        .prepare(
            `SELECT DISTINCT serie_key, serie, temporada, episodio, audio, subs FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'episode' AND visto = 1 AND temporada IS NOT NULL AND episodio IS NOT NULL
                 AND inicio >= ? AND inicio < ?`,
        )
        .all(guildId, String(tautulliUserId), desde, hasta);
    const porSerie = new Map();
    for (const r of eps) {
        const porKey = ctx.seriesPorKey.get(r.serie_key);
        const f = porKey?.encontrada ? porKey : ctx.seriesPorTitulo.get(normalizar(r.serie)) || porKey;
        if (!f) continue;
        if (!porSerie.has(f.rating_key))
            porSerie.set(f.rating_key, { ficha: f, anime: plexFichas.esAnime(f, ctx.anime), vistos: new Set(), porModo: new Map() });
        const s = porSerie.get(f.rating_key);
        const ep = `${r.temporada}:${r.episodio}`;
        s.vistos.add(ep);
        for (const m of plexIdiomas.modosDe(r.audio, r.subs, s.anime)) {
            if (!s.porModo.has(m)) s.porModo.set(m, new Set());
            s.porModo.get(m).add(ep);
        }
    }
    return porSerie;
}

/** Series con sus temporadas terminadas, y las cuentas (anime, completas y por idioma) a partir de las series vistas. */
function resumenSeries(porSerie, pelisPorModo, animePeliculas) {
    const series = [];
    const idioma = Object.fromEntries(
        Object.keys(plexIdiomas.MODOS).map((m) => [m, { eps: 0, pelis: pelisPorModo.get(m).size, series: 0 }]),
    );
    const cuentas = { animePeliculas, animeSeries: 0, animeEpisodios: 0, animeCompletas: 0, seriesCompletas: 0, idioma };
    for (const { ficha, anime, vistos, porModo } of porSerie.values()) {
        const temporadas = Object.entries(ficha.temporadas || {})
            .map(([n, lista]) => ({ n: Number(n), episodios: lista }))
            .filter((t) => t.n > 0 && t.episodios.length)
            .sort((a, b) => a.n - b.n);
        const todos = (set) => temporadas.every((t) => t.episodios.every((e) => set.has(`${t.n}:${e}`)));
        const terminadas = temporadas.filter((t) => t.episodios.every((e) => vistos.has(`${t.n}:${e}`)));
        const total = temporadas.reduce((s, t) => s + t.episodios.length, 0);
        const completa = temporadas.length > 0 && terminadas.length === temporadas.length && total >= 2;
        const vistosEnFicha = temporadas.reduce((s, t) => s + t.episodios.filter((e) => vistos.has(`${t.n}:${e}`)).length, 0);
        if (anime) {
            cuentas.animeSeries++;
            cuentas.animeEpisodios += vistos.size;
            if (completa) cuentas.animeCompletas++;
        } else if (completa) cuentas.seriesCompletas++;
        // Por idioma: cada episodio visto así, y la serie entera si todos sus episodios se vieron así (alguna vez).
        const completaEn = [];
        for (const [m, set] of porModo) {
            idioma[m].eps += set.size;
            if (completa && todos(set)) {
                idioma[m].series++;
                completaEn.push(m);
            }
        }
        series.push({ ficha, anime, temporadas, terminadas, total, completa, vistosEnFicha, completaEn, vistos, porModo });
    }
    return { series, cuentas };
}

/** Qué ha visto alguien, cruzado con las fichas: películas (por título), series con sus temporadas terminadas, cuentas
 * y, por cada versión de idioma (plexIdiomas.MODOS), episodios, películas y series enteras vistas así.
 * `rango` ({ desde, hasta } unix en segundos, hasta sin incluir): solo lo empezado a ver entre esas fechas (los trofeos
 * de admin con fechas). */
function datosUsuario(guildId, tautulliUserId, ctx, rango = null) {
    const [desde, hasta] = rango ? [rango.desde, rango.hasta] : [0, Number.MAX_SAFE_INTEGER];
    const { vistas, fichasVistas, pelisPorModo } = peliculasVistas(guildId, tautulliUserId, ctx, desde, hasta);
    const { porGenero, porDecada, porPais, animePeliculas } = resumenPeliculas(fichasVistas, ctx.anime);
    const porSerie = seriesVistas(guildId, tautulliUserId, ctx, desde, hasta);
    const { series, cuentas } = resumenSeries(porSerie, pelisPorModo, animePeliculas);
    return { vistas, fichasVistas, porGenero, porDecada, porPais, series, cuentas };
}

/** Horas, películas y episodios distintos vistos entre dos fechas (unix, s): para los trofeos de admin con fechas. */
function estadisticasEntre(guildId, tautulliUserId, { desde, hasta }) {
    const r = db
        .prepare(
            `SELECT COALESCE(SUM(segundos), 0) AS segundos,
                    COUNT(DISTINCT CASE WHEN tipo = 'movie' AND visto = 1 THEN rating_key END) AS peliculas,
                    COUNT(DISTINCT CASE WHEN tipo = 'episode' AND visto = 1 THEN rating_key END) AS episodios
             FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND inicio >= ? AND inicio < ?`,
        )
        .get(guildId, String(tautulliUserId), desde, hasta);
    return { horas: Math.floor(r.segundos / 3600), peliculas: r.peliculas, episodios: r.episodios };
}

module.exports = { contexto, datosUsuario, estadisticasEntre };
