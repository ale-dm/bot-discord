// 🍿 Trofeos de Plex, fases 2 y 3 (F-PX-02b y F-PX-02c). Con la copia del historial (plex_reproducciones) y las fichas
// de Tautulli (systems/plexFichas):
//   - Fase 2, de cada título: terminar una temporada, una serie entera o una saga (colección de Plex). Separados en
//     series y anime (🎌): lo que es anime lo dicen las bibliotecas (configAnime).
//   - Fase 3, por significado: películas de un género (10 y 25), todas las de un director que hay en Plex, 10 películas
//     de una década (antes de 2000), y los que crea un admin en /paneladmin → Plex → 🏆 Trofeos.
//   - Contadores fijos del catálogo (achievementsSystem): películas, series y episodios de anime y series terminadas.
// Los de cada título y los de significado se crean la primera vez que alguien los consigue, con un nombre temático que
// propone Gemini ("Say my name" al terminar Breaking Bad) y que se guarda; para los demás solo se ven cuando los
// consiguen. Son logros normales de la categoría plex (id "plext:…"): se reclaman en /perfil → 🏅 Logros.
const db = require("../core/db");
const plexFichas = require("./plexFichas");
const plexLinks = require("./plexLinks");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");
const { normalizar, clavePelicula } = plexFichas;

const PREFIJO = "plext:";
/** Nombres pedidos a Gemini por sincronización (la primera importación puede crear cientos) y por llamada. */
const MAX_NOMBRES_IA = 150;
const LOTE_IA = 40;
const DIRECTOR_MIN_PELICULAS = 3;
const SAGA = { min: 2, max: 40 };
const UMBRALES_GENERO = [10, 25];
const DECADA = { peliculas: 10, antesDe: 2000 };

/** Contadores fijos del catálogo (achievementsSystem, categoría plex) que salen de las fichas. */
const EVENTOS_FICHAS = {
    animePeliculas: "plex_anime_peliculas",
    animeSeries: "plex_anime_series",
    animeEpisodios: "plex_anime_episodios",
    animeCompletas: "plex_anime_completas",
    seriesCompletas: "plex_series_completas",
};

const RECOMPENSA = {
    temporada: (episodios) => Math.min(300, 100 + 5 * episodios),
    serie: (episodios) => Math.min(1500, 250 + 10 * episodios),
    saga: (peliculas) => Math.min(1000, 100 * peliculas),
    director: (peliculas) => Math.min(1000, 100 * peliculas),
    genero: { 10: 400, 25: 1000 },
    decada: 400,
};

const EMOJI = { temporada: "📺", serie: "📺", saga: "🎬", director: "🎥", genero: "🎭", decada: "📼", admin: "🏆" };

const slug = (s) =>
    normalizar(s)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) || "x";

// El mismo género en español y en inglés (depende del idioma del agente de Plex): se cuentan juntos.
const GENERO_CANONICO = {
    horror: "terror",
    comedy: "comedia",
    action: "accion",
    adventure: "aventura",
    animation: "animacion",
    "science fiction": "ciencia ficcion",
    "sci-fi": "ciencia ficcion",
    "sci-fi & fantasy": "ciencia ficcion",
    fantasy: "fantasia",
    crime: "crimen",
    documentary: "documental",
    mystery: "misterio",
    family: "familia",
    history: "historia",
    war: "belica",
    guerra: "belica",
    music: "musica",
    musical: "musica",
    thriller: "suspense",
};
const canonico = (g) => GENERO_CANONICO[normalizar(g)] || normalizar(g);
const NOMBRE_GENERO = {
    terror: "Sin pegar ojo",
    comedia: "Risa floja",
    accion: "Explosiones a cámara lenta",
    drama: "Pañuelos a mano",
    "ciencia ficcion": "Viajero de las estrellas",
    fantasia: "Más allá del portal",
    animacion: "Dibujos para mayores",
    romance: "Corazón de palomitas",
    suspense: "Al borde del sofá",
    crimen: "Expediente criminal",
    documental: "Ojo documental",
    aventura: "Mochila al hombro",
    misterio: "Detective de sofá",
    belica: "Veterano de trinchera",
    western: "Forastero en el saloon",
    musica: "Banda sonora",
    familia: "Tarde de domingo",
    historia: "Lección de historia",
    anime: "Sensei del anime",
};

// ─── Catálogo (los trofeos ya creados, como logros) ──────────────────────────
const cacheCatalogo = new Map();

function aLogro(t) {
    return {
        id: PREFIJO + t.id,
        name: t.nombre,
        desc: t.descripcion,
        category: "plex",
        event: PREFIJO + t.id,
        metric: "max",
        target: Math.max(1, Number(t.objetivo) || 1),
        rewardCoins: Number(t.recompensa) || 0,
        emoji: t.anime ? "🎌" : EMOJI[t.tipo],
        trofeo: t.tipo,
        anime: Boolean(t.anime),
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

/** Qué ha visto alguien, cruzado con las fichas: películas (por título), series con sus temporadas terminadas y cuentas. */
function datosUsuario(guildId, tautulliUserId, ctx) {
    const pelis = db
        .prepare(
            "SELECT DISTINCT rating_key, titulo, anio FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'movie' AND visto = 1",
        )
        .all(guildId, String(tautulliUserId));
    const vistas = new Set();
    const fichasVistas = new Map();
    for (const r of pelis) {
        vistas.add(clavePelicula(r.titulo, r.anio));
        const f = ctx.peliculasPorKey.get(r.rating_key) || ctx.peliculasPorTitulo.get(clavePelicula(r.titulo, r.anio));
        if (!f) continue;
        vistas.add(clavePelicula(f.titulo, f.anio));
        fichasVistas.set(clavePelicula(f.titulo, f.anio), f);
    }

    const porGenero = new Map();
    const porDecada = new Map();
    let animePeliculas = 0;
    for (const f of fichasVistas.values()) {
        if (plexFichas.esAnime(f, ctx.anime)) animePeliculas++;
        // Una vez por película aunque tenga el mismo género en dos idiomas ("Terror" y "Horror").
        const generos = new Map(f.generos.map((g) => [canonico(g), g]));
        for (const [k, g] of generos) {
            if (!porGenero.has(k)) porGenero.set(k, { nombre: g, n: 0 });
            porGenero.get(k).n++;
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
            `SELECT DISTINCT serie_key, serie, temporada, episodio FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'episode' AND visto = 1 AND temporada IS NOT NULL AND episodio IS NOT NULL`,
        )
        .all(guildId, String(tautulliUserId));
    const porSerie = new Map();
    for (const r of eps) {
        const porKey = ctx.seriesPorKey.get(r.serie_key);
        const f = porKey?.encontrada ? porKey : ctx.seriesPorTitulo.get(normalizar(r.serie)) || porKey;
        if (!f) continue;
        if (!porSerie.has(f.rating_key)) porSerie.set(f.rating_key, { ficha: f, vistos: new Set() });
        porSerie.get(f.rating_key).vistos.add(`${r.temporada}:${r.episodio}`);
    }
    const series = [];
    const cuentas = { animePeliculas, animeSeries: 0, animeEpisodios: 0, animeCompletas: 0, seriesCompletas: 0 };
    for (const { ficha, vistos } of porSerie.values()) {
        const anime = plexFichas.esAnime(ficha, ctx.anime);
        const temporadas = Object.entries(ficha.temporadas || {})
            .map(([n, lista]) => ({ n: Number(n), episodios: lista }))
            .filter((t) => t.n > 0 && t.episodios.length)
            .sort((a, b) => a.n - b.n);
        const terminadas = temporadas.filter((t) => t.episodios.every((e) => vistos.has(`${t.n}:${e}`)));
        const total = temporadas.reduce((s, t) => s + t.episodios.length, 0);
        const completa = temporadas.length > 0 && terminadas.length === temporadas.length && total >= 2;
        const vistosEnFicha = temporadas.reduce((s, t) => s + t.episodios.filter((e) => vistos.has(`${t.n}:${e}`)).length, 0);
        if (anime) {
            cuentas.animeSeries++;
            cuentas.animeEpisodios += vistos.size;
            if (completa) cuentas.animeCompletas++;
        } else if (completa) cuentas.seriesCompletas++;
        series.push({ ficha, anime, temporadas, terminadas, total, completa, vistosEnFicha });
    }
    return { vistas, fichasVistas, porGenero, porDecada, series, cuentas };
}

// ─── Trofeos automáticos ─────────────────────────────────────────────────────
/** Los trofeos automáticos que alguien ya tiene (todos completos: objetivo 1), con lo necesario para crearlos. */
function candidatos(datos, ctx) {
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
                nombre: `${ficha.titulo}: completada`,
                descripcion: `${marca}Termina ${ficha.titulo} entera (${s.total} episodios)`,
                ia: `Terminar entera la ${tipoSerie} "${ficha.titulo}"${anio}, ${s.total} episodios`,
            });
        }
    }

    // "Todas las de…" y sagas: solo con la biblioteca entera conocida (si no, faltarían películas y saldría antes de tiempo).
    if (ctx.completa) {
        for (const [k, d] of ctx.directores) {
            const pelis = [...d.peliculas.keys()];
            if (pelis.length < DIRECTOR_MIN_PELICULAS || !pelis.every((p) => datos.vistas.has(p))) continue;
            lista.push({
                id: `director:${k}`,
                tipo: "director",
                anime: false,
                recompensa: RECOMPENSA.director(pelis.length),
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
                nombre: `Saga completa: ${s.nombre}`,
                descripcion: `${anime ? "🎌 " : ""}Ve todas las películas de la colección ${s.nombre} (${pelis.length})`,
                ia: `Ver todas las películas de la saga "${s.nombre}": ${titulos(s.peliculas)}`,
            });
        }
    }

    for (const [k, g] of datos.porGenero) {
        for (const u of UMBRALES_GENERO) {
            if (g.n < u) continue;
            const base = NOMBRE_GENERO[k] || `Fan del género ${g.nombre}`;
            lista.push({
                id: `genero:${slug(k)}:${u}`,
                tipo: "genero",
                anime: k === "anime",
                recompensa: RECOMPENSA.genero[u],
                nombre: u === UMBRALES_GENERO[0] ? base : `${base} · Experto`,
                descripcion: `Ve ${u} películas de ${g.nombre}`,
            });
        }
    }
    for (const [d, n] of datos.porDecada) {
        if (d >= DECADA.antesDe || n < DECADA.peliculas) continue;
        const dd = String(d).slice(2);
        lista.push({
            id: `decada:${d}`,
            tipo: "decada",
            anime: false,
            recompensa: RECOMPENSA.decada,
            nombre: `Máquina del tiempo: los ${dd}`,
            descripcion: `Ve ${DECADA.peliculas} películas de los años ${d < 1930 ? d : dd}`,
        });
    }
    return lista;
}

function titulos(peliculas) {
    const t = [...peliculas.values()].map((p) => `${p.titulo}${p.anio ? ` (${p.anio})` : ""}`);
    return t.slice(0, 8).join(", ") + (t.length > 8 ? "…" : "");
}

// ─── Trofeos de admin (condición en texto) ──────────────────────────────────
const CONDICIONES = {
    genero: { valor: true, n: true, ayuda: "`genero:Terror 20` → 20 películas de ese género" },
    director: {
        valor: true,
        n: "opcional",
        ayuda: "`director:Christopher Nolan` → todas las suyas que hay en Plex (o `director:Nolan 5`)",
    },
    decada: { valor: "anio", n: true, ayuda: "`decada:1980 10` → 10 películas de los 80" },
    saga: { valor: true, ayuda: "`saga:Harry Potter` → todas las películas de esa colección" },
    serie: { valor: true, ayuda: "`serie:Breaking Bad` → terminarla entera" },
    pelicula: { valor: true, ayuda: "`pelicula:Titanic` → verla" },
    peliculas: { n: true, ayuda: "`peliculas 50` · `episodios 500` · `horas 200`" },
    episodios: { n: true },
    horas: { n: true },
    "series-completas": { n: true, ayuda: "`series-completas 10` → terminar 10 series (sin anime)" },
    "anime-peliculas": { n: true, ayuda: "`anime-peliculas 10` · `anime-series 5` · `anime-episodios 300` · `anime-completas 3`" },
    "anime-series": { n: true },
    "anime-episodios": { n: true },
    "anime-completas": { n: true },
};

/** Lee una condición escrita por un admin ("genero:Terror 20"). @returns {{ ok: true, cond } | { ok: false, error }} */
function parsearCondicion(texto) {
    const m = /^\s*([a-z-]+)\s*(?::\s*(.+?))?(?:\s+(\d+))?\s*$/i.exec(String(texto || ""));
    if (!m)
        return {
            ok: false,
            error: "No entiendo la condición: va como `tipo:valor número`, por ejemplo `genero:Terror 20` o `peliculas 50`.",
        };
    const tipo = m[1].toLowerCase();
    const def = CONDICIONES[tipo];
    if (!def) return { ok: false, error: `No conozco el tipo "${tipo}".` };
    let valor = (m[2] || "").trim();
    let n = m[3] ? Number(m[3]) : null;
    // En títulos el número es parte del nombre ("pelicula:Blade Runner 2049").
    if (["serie", "saga", "pelicula"].includes(tipo) && n !== null) {
        valor = `${valor} ${n}`.trim();
        n = null;
    }
    if (def.valor && !valor) return { ok: false, error: `Falta el valor: ${def.ayuda || tipo}` };
    if (!def.valor && valor) return { ok: false, error: `"${tipo}" no lleva valor después de los dos puntos.` };
    if (def.valor === "anio") {
        if (!/^\d{4}$/.test(valor)) return { ok: false, error: "La década va con el año: `decada:1980 10`." };
        valor = String(Math.floor(Number(valor) / 10) * 10);
    }
    if (def.n === true && !(n > 0)) return { ok: false, error: `Falta cuántos: ${def.ayuda || `\`${tipo} 10\``}` };
    if (def.n === undefined && n !== null) n = null;
    const texto2 = `${tipo}${valor ? `:${valor}` : ""}${n ? ` ${n}` : ""}`;
    return { ok: true, cond: { tipo, valor, n }, texto: texto2 };
}

/** Busca por nombre en un mapa { slug → { nombre } }: igual o, si no, el único que lo contiene. */
function buscarPorNombre(mapa, valor) {
    const v = normalizar(valor);
    const lista = [...mapa.values()];
    const exacto = lista.find((x) => normalizar(x.nombre) === v);
    if (exacto) return exacto;
    const parecidos = lista.filter((x) => normalizar(x.nombre).includes(v));
    return parecidos.length === 1 ? parecidos[0] : null;
}

/**
 * Progreso de alguien en un trofeo de admin y su objetivo. null si todavía no se puede saber (p. ej. "todas las de un
 * director" sin la biblioteca entera).
 */
function evaluarCondicion(cond, datos, ctx, stats = {}) {
    const { tipo, valor, n } = cond;
    switch (tipo) {
        case "genero":
            return { progreso: datos.porGenero.get(canonico(valor))?.n || 0, objetivo: n };
        case "decada":
            return { progreso: datos.porDecada.get(Number(valor)) || 0, objetivo: n };
        case "director":
        case "saga": {
            if (!ctx.completa) return null;
            const x = buscarPorNombre(tipo === "director" ? ctx.directores : ctx.sagas, valor);
            if (!x) return { progreso: 0, objetivo: n || 1 };
            const pelis = [...x.peliculas.keys()];
            return { progreso: pelis.filter((p) => datos.vistas.has(p)).length, objetivo: n || pelis.length };
        }
        case "serie": {
            const lista = new Map(datos.series.map((s) => [s.ficha.rating_key, s]));
            const ficha =
                ctx.seriesPorTitulo.get(normalizar(valor)) ||
                buscarPorNombre(new Map([...ctx.seriesPorKey.values()].map((s) => [s.rating_key, { ...s, nombre: s.titulo }])), valor);
            if (!ficha) return { progreso: 0, objetivo: 1 };
            const s = lista.get(ficha.rating_key);
            const total = Object.entries(ficha.temporadas || {})
                .filter(([t]) => Number(t) > 0)
                .reduce((sum, [, eps]) => sum + eps.length, 0);
            return { progreso: s ? s.vistosEnFicha : 0, objetivo: Math.max(1, total) };
        }
        case "pelicula": {
            const v = normalizar(valor);
            const vista = [...datos.vistas].some((k) => k.split("|")[0] === v);
            return { progreso: vista ? 1 : 0, objetivo: 1 };
        }
        case "peliculas":
            return { progreso: stats.peliculas || 0, objetivo: n };
        case "episodios":
            return { progreso: stats.episodios || 0, objetivo: n };
        case "horas":
            return { progreso: stats.horas || 0, objetivo: n };
        case "series-completas":
            return { progreso: datos.cuentas.seriesCompletas, objetivo: n };
        case "anime-peliculas":
            return { progreso: datos.cuentas.animePeliculas, objetivo: n };
        case "anime-series":
            return { progreso: datos.cuentas.animeSeries, objetivo: n };
        case "anime-episodios":
            return { progreso: datos.cuentas.animeEpisodios, objetivo: n };
        case "anime-completas":
            return { progreso: datos.cuentas.animeCompletas, objetivo: n };
        default:
            return null;
    }
}

// ─── Nombres con Gemini ──────────────────────────────────────────────────────
function limpiarNombre(s) {
    const t = String(s || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/^["'«“\s]+|["'»”\s]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return t ? t.slice(0, 60) : null;
}

/** Pide a Gemini un nombre temático para cada trofeo ({ id, ia }). @returns {Promise<Map<string, string>>} id → nombre */
async function nombrarConIA(guildId, items) {
    const nombres = new Map();
    if (!items.length || !process.env.GOOGLE_API_KEY) return nombres;
    const { generateContentWithTimeout } = require("../services/geminiClient");
    const { GEMINI_MODEL } = require("./duende/config");
    const modelo = guildSettings.getSettings(guildId).duende.model || GEMINI_MODEL;
    for (let i = 0; i < items.length; i += LOTE_IA) {
        const lote = items.slice(i, i + LOTE_IA);
        const prompt =
            "Pon nombre a trofeos de un servidor de Discord de amigos que ven series, anime y películas en Plex. Cada trofeo se " +
            "gana al terminar algo. El nombre tiene que sonar a esa obra: una frase mítica, un guiño o un personaje (por " +
            'ejemplo, al terminar Breaking Bad: "Say my name"; Juego de Tronos: "Winter is coming"). Corto (máximo 40 ' +
            "caracteres), sin spoilers del final, sin comillas ni emojis, en español salvo que la frase célebre sea en su " +
            "idioma original. Distinto para cada trofeo.\n\n" +
            lote.map((x) => `${x.id} → ${x.ia}`).join("\n") +
            '\n\nResponde solo con un objeto JSON: {"<id>": "<nombre>", ...} con todos los id de arriba.';
        try {
            const r = await generateContentWithTimeout(
                {
                    model: modelo,
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    config: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
                },
                45000,
                "Trofeos de Plex",
            );
            const texto =
                typeof r?.text === "string" ? r.text : r?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
            const json = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
            const pares = Array.isArray(json) ? json.map((x) => [x.id || x.clave, x.nombre || x.name]) : Object.entries(json);
            const validos = new Set(lote.map((x) => x.id));
            for (const [id, nombre] of pares) {
                const limpio = limpiarNombre(nombre);
                if (validos.has(id) && limpio) nombres.set(id, limpio);
            }
        } catch (e) {
            log.warn(`Gemini no pudo poner nombre a ${lote.length} trofeos de Plex (se quedan con el nombre por defecto): ${e.message}`);
        }
    }
    return nombres;
}

/** Guarda los trofeos nuevos (con el nombre de Gemini si lo hay). */
async function crear(guildId, lista) {
    const conIA = lista.filter((c) => c.ia).slice(0, MAX_NOMBRES_IA);
    const nombres = await nombrarConIA(guildId, conIA);
    const insertar = db.prepare(
        `INSERT OR IGNORE INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, nombre_ia, creado)
         VALUES (@guildId, @id, @tipo, @nombre, @descripcion, 1, @recompensa, @anime, @nombre_ia, @creado)`,
    );
    const ahora = Date.now();
    db.transaction(() => {
        for (const c of lista) {
            insertar.run({
                guildId,
                id: c.id,
                tipo: c.tipo,
                nombre: nombres.get(c.id) || c.nombre,
                descripcion: c.descripcion,
                recompensa: c.recompensa,
                anime: c.anime ? 1 : 0,
                nombre_ia: nombres.has(c.id) ? 1 : 0,
                creado: ahora,
            });
        }
    })();
    cacheCatalogo.delete(guildId);
    log.info(`Trofeos de Plex nuevos en ${guildId}: ${lista.length} (${nombres.size} con nombre de Gemini)`);
}

// ─── Evaluación ──────────────────────────────────────────────────────────────
/**
 * Los eventos de logros de cada vinculado que salen de las fichas: los contadores fijos (anime, series terminadas), los
 * trofeos automáticos que tiene (creándolos si es el primero) y su progreso en los de admin.
 * @param {Array<{ discordUserId, tautulliUserId }>} links
 * @param {Map<string, object>} statsPorUsuario estadísticas de la fase 1 (plexHistorial.estadisticas) de cada uno
 * @returns {Promise<Map<string, Array<{ event: string, value: number }>>>} discordUserId → eventos
 */
async function eventosDe(guildId, links, statsPorUsuario = new Map()) {
    const ctx = contexto(guildId);
    const existentes = new Set(trofeos(guildId).map((t) => t.id));
    const admin = trofeos(guildId, "admin")
        .map((t) => ({ t, p: parsearCondicion(t.condicion) }))
        .filter((x) => x.p.ok);
    const nuevos = new Map();
    const objetivos = new Map();
    const porUsuario = new Map();
    for (const link of links) {
        const datos = datosUsuario(guildId, link.tautulliUserId, ctx);
        const eventos = Object.entries(EVENTOS_FICHAS).map(([campo, event]) => ({ event, value: datos.cuentas[campo] }));
        for (const c of candidatos(datos, ctx)) {
            if (!existentes.has(c.id) && !nuevos.has(c.id)) nuevos.set(c.id, c);
            eventos.push({ event: PREFIJO + c.id, value: 1 });
        }
        for (const { t, p } of admin) {
            const r = evaluarCondicion(p.cond, datos, ctx, statsPorUsuario.get(link.discordUserId));
            if (!r) continue;
            if (r.objetivo > 0) objetivos.set(t.id, r.objetivo);
            eventos.push({ event: PREFIJO + t.id, value: r.progreso });
        }
        porUsuario.set(link.discordUserId, eventos);
    }
    if (nuevos.size) await crear(guildId, [...nuevos.values()]);
    // El objetivo de "todas las de…" o "terminar una serie" cambia si se añaden películas o episodios.
    const cambiar = db.prepare("UPDATE plex_trofeos SET objetivo = ? WHERE guildId = ? AND id = ? AND objetivo != ?");
    let cambiados = 0;
    for (const [id, objetivo] of objetivos) cambiados += cambiar.run(objetivo, guildId, id, objetivo).changes;
    if (cambiados) cacheCatalogo.delete(guildId);
    return porUsuario;
}

// ─── Rareza, preferencias y admin ────────────────────────────────────────────
/** Qué % de los vinculados a Plex tiene cada logro de Plex. @returns {Map<string, number>} achievementId → % */
function rarezas(guildId) {
    const links = plexLinks.getLinks(guildId);
    const mapa = new Map();
    if (!links.length) return mapa;
    const ids = links.map((l) => l.discordUserId);
    const filas = db
        .prepare(
            `SELECT achievementId, COUNT(*) AS n FROM achievements_progress
             WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId LIKE 'plex%' AND userId IN (${ids.map(() => "?").join(",")})
             GROUP BY achievementId`,
        )
        .all(guildId, ...ids);
    for (const f of filas) mapa.set(f.achievementId, Math.max(1, Math.round((f.n / links.length) * 100)));
    return mapa;
}

function textoRareza(pct) {
    if (!pct) return "nadie lo tiene todavía";
    return pct <= 10 ? `solo el ${pct} % del servidor lo tiene` : `lo tiene el ${pct} % del servidor`;
}

/** Para el anuncio: a los trofeos (fases 2 y 3) se les añade de qué son y lo raros que son. */
function paraAnuncio(guildId, desbloqueados) {
    if (!desbloqueados.some((a) => a.trofeo)) return desbloqueados;
    const r = rarezas(guildId);
    return desbloqueados.map((a) => (a.trofeo ? { ...a, detalleAnuncio: `${a.desc} · ${textoRareza(r.get(a.id))}` } : a));
}

function oculto(guildId, userId) {
    return Boolean(db.prepare("SELECT ocultar FROM plex_preferencias WHERE guildId = ? AND userId = ?").get(guildId, userId)?.ocultar);
}

function setOculto(guildId, userId, valor) {
    db.prepare(
        `INSERT INTO plex_preferencias (guildId, userId, ocultar) VALUES (?, ?, ?)
         ON CONFLICT(guildId, userId) DO UPDATE SET ocultar = excluded.ocultar`,
    ).run(guildId, userId, valor ? 1 : 0);
    log.info(`${userId} ${valor ? "oculta" : "enseña"} sus logros de Plex en ${guildId}`);
}

/** Crea un trofeo de admin. @returns {{ ok: true, trofeo } | { ok: false, error }} */
function crearAdmin(guildId, { nombre, descripcion, condicion, recompensa }, actorId) {
    const p = parsearCondicion(condicion);
    if (!p.ok) return p;
    const n = limpiarNombre(nombre);
    if (!n) return { ok: false, error: "Falta el nombre." };
    const coins = Math.floor(Number(String(recompensa ?? "").replace(/\./g, "")));
    if (!Number.isFinite(coins) || coins < 0 || coins > 1_000_000)
        return { ok: false, error: "La recompensa tiene que ser un número entre 0 y 1.000.000." };
    // Id único aunque se creen dos en el mismo milisegundo.
    const existe = db.prepare("SELECT 1 FROM plex_trofeos WHERE guildId = ? AND id = ?");
    let id = `admin:${Date.now().toString(36)}`;
    for (let i = 2; existe.get(guildId, id); i++) id = `admin:${Date.now().toString(36)}-${i}`;
    const trofeo = {
        guildId,
        id,
        tipo: "admin",
        nombre: n,
        descripcion:
            String(descripcion || "")
                .trim()
                .slice(0, 200) || describirCondicion(p.cond),
        objetivo: p.cond.n || 1,
        recompensa: coins,
        condicion: p.texto,
        creado: Date.now(),
        creado_por: actorId || null,
    };
    db.prepare(
        `INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, condicion, creado, creado_por)
         VALUES (@guildId, @id, @tipo, @nombre, @descripcion, @objetivo, @recompensa, @condicion, @creado, @creado_por)`,
    ).run(trofeo);
    cacheCatalogo.delete(guildId);
    log.info(`Trofeo de Plex creado en ${guildId} por ${actorId}: "${n}" (${p.texto}, ${coins} monedas)`);
    return { ok: true, trofeo };
}

function describirCondicion({ tipo, valor, n }) {
    const textos = {
        genero: `Ve ${n} películas de ${valor}`,
        decada: `Ve ${n} películas de los años ${String(valor).slice(2)}`,
        director: n ? `Ve ${n} películas de ${valor}` : `Ve todas las películas de ${valor} que hay en Plex`,
        saga: `Ve todas las películas de la saga ${valor}`,
        serie: `Termina ${valor} entera`,
        pelicula: `Ve ${valor}`,
        peliculas: `Ve ${n} películas distintas`,
        episodios: `Ve ${n} episodios distintos`,
        horas: `Ve ${n} horas en Plex`,
        "series-completas": `Termina ${n} series (sin contar anime)`,
        "anime-peliculas": `Ve ${n} películas de anime`,
        "anime-series": `Ve episodios de ${n} series de anime`,
        "anime-episodios": `Ve ${n} episodios de anime`,
        "anime-completas": `Termina ${n} series de anime`,
    };
    return textos[tipo] || tipo;
}

/** Borra un trofeo (y el progreso de cada uno en él; lo ya reclamado no se devuelve). */
function borrar(guildId, id) {
    const r = db.prepare("DELETE FROM plex_trofeos WHERE guildId = ? AND id = ?").run(guildId, id);
    db.prepare("DELETE FROM achievements_progress WHERE guildId = ? AND achievementId = ?").run(guildId, PREFIJO + id);
    cacheCatalogo.delete(guildId);
    return r.changes > 0;
}

/** Cuántos trofeos hay de cada tipo y cuántas personas tienen cada uno de los de admin (para el panel). */
function resumen(guildId) {
    const porTipo = Object.fromEntries(
        db
            .prepare("SELECT tipo, COUNT(*) AS n FROM plex_trofeos WHERE guildId = ? GROUP BY tipo")
            .all(guildId)
            .map((f) => [f.tipo, f.n]),
    );
    const quienes = new Map(
        db
            .prepare(
                `SELECT achievementId, COUNT(*) AS n FROM achievements_progress
                 WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId LIKE 'plext:admin:%' GROUP BY achievementId`,
            )
            .all(guildId)
            .map((f) => [f.achievementId.slice(PREFIJO.length), f.n]),
    );
    return { porTipo, admin: trofeos(guildId, "admin").map((t) => ({ ...t, completados: quienes.get(t.id) || 0 })) };
}

module.exports = {
    PREFIJO,
    EVENTOS_FICHAS,
    CONDICIONES,
    catalogo,
    eventosDe,
    datosUsuario,
    contexto,
    parsearCondicion,
    crearAdmin,
    borrar,
    resumen,
    rarezas,
    textoRareza,
    paraAnuncio,
    oculto,
    setOculto,
};
