// 🍿 Trofeos de Plex: qué trofeos tiene cada persona (con el historial y las fichas) y el catálogo de los ya creados.
const db = require("../../core/db");
const plexFichas = require("../plexFichas");
const plexIdiomas = require("../plexIdiomas");
const {
    PREFIJO,
    DIRECTOR_MIN_PELICULAS,
    SAGA,
    UMBRALES_GENERO,
    UMBRALES_PAIS,
    DECADA,
    RECOMPENSA,
    DIFICULTAD,
    dificultadGuardada,
    EMOJI,
    slug,
    canonico,
    NOMBRE_GENERO,
    normalizar,
    clavePelicula,
} = require("./base");
const { rangoDe, parsearCondicion } = require("./condiciones");

// ─── Catálogo (los trofeos ya creados, como logros) ──────────────────────────
const cacheCatalogo = new Map();
function aLogro(t) {
    // Un trofeo de admin con fecha de fin: pasado el plazo, solo lo ve quien lo consiguió.
    const p = t.tipo === "admin" && t.condicion ? parsearCondicion(t.condicion) : null;
    const rango = p?.ok ? rangoDe(p.cond) : null;
    return {
        ...(rango && rango.hasta < Number.MAX_SAFE_INTEGER ? { visibleHasta: rango.hasta * 1000 } : {}),
        id: PREFIJO + t.id,
        name: t.nombre,
        desc: t.descripcion,
        category: "plex",
        event: PREFIJO + t.id,
        metric: "max",
        target: Math.max(1, Number(t.objetivo) || 1),
        rewardCoins: Number(t.recompensa) || 0,
        emoji: t.anime ? "🎌" : t.tipo === "idioma" ? plexIdiomas.MODOS[t.id.split(":")[2]]?.emoji || "🗣️" : EMOJI[t.tipo],
        trofeo: t.tipo,
        anime: Boolean(t.anime),
        dificultad: dificultadGuardada(t),
        // Los de admin se ven siempre (con su progreso); el resto, solo a quien los tiene.
        soloCompletado: t.tipo !== "admin",
    };
}
/** Los trofeos creados en un servidor como logros del catálogo (lo usa achievementsSystem.getCatalog). */
function catalogo(guildId) {
    if (!cacheCatalogo.has(guildId)) {
        const filas = db.prepare("SELECT * FROM plex_trofeos WHERE guildId = ? ORDER BY creado, id").all(guildId);
        cacheCatalogo.set(guildId, filas.map(aLogro));
    }
    return cacheCatalogo.get(guildId);
}
function trofeos(guildId, tipo = null) {
    return tipo
        ? db.prepare("SELECT * FROM plex_trofeos WHERE guildId = ? AND tipo = ? ORDER BY creado, id").all(guildId, tipo)
        : db.prepare("SELECT * FROM plex_trofeos WHERE guildId = ? ORDER BY creado, id").all(guildId);
}

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
/** Qué ha visto alguien, cruzado con las fichas: películas (por título), series con sus temporadas terminadas, cuentas
 * y, por cada versión de idioma (plexIdiomas.MODOS), episodios, películas y series enteras vistas así.
 * `rango` ({ desde, hasta } unix en segundos, hasta sin incluir): solo lo empezado a ver entre esas fechas (los trofeos
 * de admin con fechas). */
function datosUsuario(guildId, tautulliUserId, ctx, rango = null) {
    const [desde, hasta] = rango ? [rango.desde, rango.hasta] : [0, Number.MAX_SAFE_INTEGER];
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

    const porGenero = new Map();
    const porDecada = new Map();
    const porPais = new Map();
    let animePeliculas = 0;
    for (const f of fichasVistas.values()) {
        if (plexFichas.esAnime(f, ctx.anime)) animePeliculas++;
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

// ─── Trofeos automáticos ─────────────────────────────────────────────────────
/** Trofeos de temporada, de serie completa y de serie completa en un idioma. */
function candidatosSeries(datos) {
    const lista = [];
    for (const s of datos.series) {
        const { ficha, anime } = s;
        const tipoSerie = anime ? "serie de anime" : "serie";
        const anio = ficha.anio ? ` (${ficha.anio})` : "";
        const marca = anime ? "🎌 " : "";
        // Si solo tiene una temporada, basta con el trofeo de la serie.
        if (s.temporadas.length >= 2) {
            for (const t of s.terminadas) {
                lista.push({
                    id: `temporada:${ficha.rating_key}:${t.n}`,
                    tipo: "temporada",
                    anime,
                    recompensa: RECOMPENSA.temporada(t.episodios.length),
                    dificultad: DIFICULTAD.temporada(),
                    nombre: `${ficha.titulo}: temporada ${t.n}`,
                    descripcion: `${marca}Termina la temporada ${t.n} de ${ficha.titulo}`,
                    ia: `Terminar la temporada ${t.n} (de ${s.temporadas.length}) de la ${tipoSerie} "${ficha.titulo}"${anio}`,
                });
            }
        }
        if (s.completa) {
            lista.push({
                id: `serie:${ficha.rating_key}`,
                tipo: "serie",
                anime,
                recompensa: RECOMPENSA.serie(s.total),
                dificultad: DIFICULTAD.serie(s.total),
                nombre: `${ficha.titulo}: completada`,
                descripcion: `${marca}Termina ${ficha.titulo} entera (${s.total} episodios)`,
                ia: `Terminar entera la ${tipoSerie} "${ficha.titulo}"${anio}, ${s.total} episodios`,
            });
        }
        // Entera en una versión de idioma: "Breaking Bad en inglés" (el nombre, de Gemini, que juegue con el idioma).
        for (const m of s.completaEn) {
            const modo = plexIdiomas.MODOS[m];
            lista.push({
                id: `idioma:${ficha.rating_key}:${m}`,
                tipo: "idioma",
                anime,
                recompensa: RECOMPENSA.idioma(s.total),
                dificultad: DIFICULTAD.idioma(s.total),
                nombre: `${ficha.titulo} ${modo.texto}`,
                descripcion: `${marca}${modo.emoji} Termina ${ficha.titulo} entera ${modo.texto} (${s.total} episodios)`,
                ia: `Terminar entera la ${tipoSerie} "${ficha.titulo}"${anio} ${modo.texto}, ${s.total} episodios (que el nombre juegue con el idioma)`,
            });
        }
    }
    return lista;
}

/** "Todas las de…" (director) y sagas. Solo con la biblioteca entera conocida (si no, faltarían películas y saldría antes de tiempo). */
function candidatosColecciones(datos, ctx) {
    const lista = [];
    for (const [k, d] of ctx.directores) {
        const pelis = [...d.peliculas.keys()];
        if (pelis.length < DIRECTOR_MIN_PELICULAS || !pelis.every((p) => datos.vistas.has(p))) continue;
        const anime = [...d.peliculas.values()].every((p) => plexFichas.esAnime(p, ctx.anime));
        lista.push({
            id: `director:${k}`,
            tipo: "director",
            anime,
            recompensa: RECOMPENSA.director(pelis.length),
            dificultad: DIFICULTAD.director(pelis.length),
            nombre: `Filmografía de ${d.nombre}`,
            descripcion: `Ve todas las películas de ${d.nombre} que hay en Plex (${pelis.length})`,
            ia: `Ver todas las películas dirigidas por ${d.nombre}: ${titulos(d.peliculas)}`,
        });
    }
    for (const [k, s] of ctx.sagas) {
        const pelis = [...s.peliculas.keys()];
        if (pelis.length < SAGA.min || pelis.length > SAGA.max || !pelis.every((p) => datos.vistas.has(p))) continue;
        const anime = [...s.peliculas.values()].every((p) => plexFichas.esAnime(p, ctx.anime));
        lista.push({
            id: `saga:${k}`,
            tipo: "saga",
            anime,
            recompensa: RECOMPENSA.saga(pelis.length),
            dificultad: DIFICULTAD.saga(pelis.length),
            nombre: `Saga completa: ${s.nombre}`,
            descripcion: `${anime ? "🎌 " : ""}Ve todas las películas de la colección ${s.nombre} (${pelis.length})`,
            ia: `Ver todas las películas de la saga "${s.nombre}": ${titulos(s.peliculas)}`,
        });
    }
    return lista;
}

function candidatosGeneros(datos) {
    const lista = [];
    for (const [k, g] of datos.porGenero) {
        for (const u of UMBRALES_GENERO) {
            if (g.n < u) continue;
            const base = NOMBRE_GENERO[k] || `Fan del género ${g.nombre}`;
            lista.push({
                id: `genero:${slug(k)}:${u}`,
                tipo: "genero",
                anime: k === "anime",
                recompensa: RECOMPENSA.genero[u],
                dificultad: DIFICULTAD.genero(u),
                nombre: u === UMBRALES_GENERO[0] ? base : `${base} · Experto`,
                descripcion: `Ve ${u} películas de ${g.nombre}`,
            });
        }
    }
    return lista;
}

function candidatosPaises(datos) {
    const lista = [];
    for (const [k, p] of datos.porPais) {
        for (const u of UMBRALES_PAIS) {
            if (p.n < u) continue;
            lista.push({
                id: `pais:${slug(k)}:${u}`,
                tipo: "pais",
                anime: false,
                recompensa: RECOMPENSA.pais[u],
                dificultad: DIFICULTAD.pais(u),
                nombre: u === UMBRALES_PAIS[0] ? `Viajero de ${p.nombre}` : `Viajero de ${p.nombre} · Experto`,
                descripcion: `Ve ${u} películas de ${p.nombre}`,
            });
        }
    }
    return lista;
}

function candidatosDecadas(datos) {
    const lista = [];
    for (const [d, n] of datos.porDecada) {
        if (d >= DECADA.antesDe || n < DECADA.peliculas) continue;
        lista.push({
            id: `decada:${d}`,
            tipo: "decada",
            anime: false,
            recompensa: RECOMPENSA.decada,
            dificultad: DIFICULTAD.decada(),
            nombre: `Máquina del tiempo: los años ${d}`,
            descripcion: `Ve ${DECADA.peliculas} películas de los años ${d}`,
        });
    }
    return lista;
}

/** Los trofeos automáticos que alguien ya tiene (todos completos: objetivo 1), con lo necesario para crearlos. */
function candidatos(datos, ctx) {
    return [
        ...candidatosSeries(datos),
        ...(ctx.completa ? candidatosColecciones(datos, ctx) : []),
        ...candidatosGeneros(datos),
        ...candidatosPaises(datos),
        ...candidatosDecadas(datos),
    ];
}

function titulos(peliculas) {
    const t = [...peliculas.values()].map((p) => `${p.titulo}${p.anio ? ` (${p.anio})` : ""}`);
    return t.slice(0, 8).join(", ") + (t.length > 8 ? "…" : "");
}

module.exports = { cacheCatalogo, catalogo, trofeos, contexto, datosUsuario, estadisticasEntre, candidatos, titulos };
