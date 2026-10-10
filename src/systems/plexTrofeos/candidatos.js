// 🍿 Trofeos de Plex: qué trofeos tiene cada persona (con el historial y las fichas) y el catálogo de los ya creados.
// Lo que ha visto cada uno está en datosVistos.js; aquí quedan el catálogo y los candidatos automáticos.
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
    NOMBRE_GENERO,
} = require("./base");
const { rangoDe, parsearCondicion } = require("./condiciones");
const { contexto, datosUsuario, estadisticasEntre } = require("./datosVistos");

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
        const filas = db
            .prepare(
                "SELECT guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, condicion, nombre_ia, creado, creado_por, dificultad FROM plex_trofeos WHERE guildId = ? ORDER BY creado, id",
            )
            .all(guildId);
        cacheCatalogo.set(guildId, filas.map(aLogro));
    }
    return cacheCatalogo.get(guildId);
}
function trofeos(guildId, tipo = null) {
    return tipo
        ? db
              .prepare(
                  "SELECT guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, condicion, nombre_ia, creado, creado_por, dificultad FROM plex_trofeos WHERE guildId = ? AND tipo = ? ORDER BY creado, id",
              )
              .all(guildId, tipo)
        : db
              .prepare(
                  "SELECT guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, condicion, nombre_ia, creado, creado_por, dificultad FROM plex_trofeos WHERE guildId = ? ORDER BY creado, id",
              )
              .all(guildId);
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
