// 🍿 Idiomas de lo que se ve en Plex, para los trofeos por idioma, y la dificultad de los trofeos de Plex.
//
// El historial no dice en qué idioma se vio cada cosa: sale de get_stream_data de Tautulli (el audio elegido y los
// subtítulos que se mostraron). Se pide poco a poco, solo de lo visto por quien tiene Plex vinculado, y se guarda en
// plex_reproducciones (audio, subs). Con eso, cada reproducción cuenta en una o varias "versiones":
//   - Series y películas: 🇬🇧 inglés · 📝 VOSE (inglés con subtítulos en castellano) · 🎧 inglés sin subtítulos ·
//     🇪🇸 castellano.
//   - Anime: doblado al castellano · japonés con subtítulos en castellano · doblado al inglés · japonés con subtítulos
//     en inglés · japonés sin subtítulos.
// El español latino se distingue cuando la pista lo dice ("Latino", "Latinoamérica"...) y no cuenta como castellano.
const db = require("../core/db");
const tautulli = require("../services/tautulliClient");
const plexLinks = require("./plexLinks");
const { normalizar } = require("./plexFichas");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

/** Reproducciones revisadas por sincronización (cada 30 min) y por pulsación del botón. Solo leen la BD de Tautulli. */
const PRESUPUESTO = { cron: 1500, boton: 5000 };
const EN_PARALELO = 4;
const MAX_ERRORES_SEGUIDOS = 5;

// ─── Dificultad ──────────────────────────────────────────────────────────────
const DIFICULTADES = {
    facil: { emoji: "🟢", nombre: "Fácil" },
    normal: { emoji: "🟡", nombre: "Normal" },
    gordo: { emoji: "🎰", nombre: "Gordo del Plex" },
};
const textoDificultad = (d) => (DIFICULTADES[d] ? `${DIFICULTADES[d].emoji} ${DIFICULTADES[d].nombre}` : "");

/** "fácil", "F", "1", "gordo del plex"... → facil | normal | gordo; vacío → normal; otra cosa → null. */
function leerDificultad(texto) {
    const t = normalizar(texto);
    if (!t) return "normal";
    if (["facil", "f", "1", "🟢"].includes(t)) return "facil";
    if (["normal", "n", "2", "🟡"].includes(t)) return "normal";
    if (["gordo", "gordo del plex", "g", "3", "dificil", "maxima", "🎰"].includes(t)) return "gordo";
    return null;
}

// ─── Versiones (modos) ───────────────────────────────────────────────────────
/**
 * Cada versión: si es de anime o no, cuándo cuenta una reproducción (audio y subtítulos), cómo se dice ("en inglés")
 * y su emoji. `slug` es como se escribe en las condiciones de los trofeos de admin.
 */
const MODOS = {
    ingles: { slug: "ingles", anime: false, texto: "en inglés", emoji: "🇬🇧", cumple: (a) => a === "en" },
    vose: {
        slug: "vose",
        anime: false,
        texto: "en VOSE (inglés con subtítulos en castellano)",
        emoji: "📝",
        cumple: (a, s) => a === "en" && s === "es",
    },
    ingles_sin_subs: {
        slug: "ingles-sin-subs",
        anime: false,
        texto: "en inglés sin subtítulos",
        emoji: "🎧",
        cumple: (a, s) => a === "en" && s === "no",
    },
    castellano: { slug: "castellano", anime: false, texto: "en castellano", emoji: "🇪🇸", cumple: (a) => a === "es" },
    anime_castellano: { slug: "anime-castellano", anime: true, texto: "doblado al castellano", emoji: "🇪🇸", cumple: (a) => a === "es" },
    anime_jap_sub_es: {
        slug: "anime-jap-sub-es",
        anime: true,
        texto: "en japonés con subtítulos en castellano",
        emoji: "🇯🇵",
        cumple: (a, s) => a === "ja" && s === "es",
    },
    anime_ingles: { slug: "anime-ingles", anime: true, texto: "doblado al inglés", emoji: "🇬🇧", cumple: (a) => a === "en" },
    anime_jap_sub_en: {
        slug: "anime-jap-sub-en",
        anime: true,
        texto: "en japonés con subtítulos en inglés",
        emoji: "🇯🇵",
        cumple: (a, s) => a === "ja" && s === "en",
    },
    anime_jap_sin_subs: {
        slug: "anime-jap-sin-subs",
        anime: true,
        texto: "en japonés sin subtítulos",
        emoji: "🎧",
        cumple: (a, s) => a === "ja" && s === "no",
    },
};
const modoPorSlug = (slug) => Object.keys(MODOS).find((k) => MODOS[k].slug === normalizar(slug).replace(/_/g, "-")) || null;

/** Las versiones en las que cuenta una reproducción (audio, subtítulos y si es anime). */
function modosDe(audio, subs, anime) {
    if (!audio) return [];
    return Object.keys(MODOS).filter((k) => MODOS[k].anime === Boolean(anime) && MODOS[k].cumple(audio, subs));
}

/** El evento de logros de cada contador: plex_idioma_eps_ingles, plex_idioma_pelis_vose, plex_idioma_series_castellano... */
const evento = (tipo, modo) => `plex_idioma_${tipo}_${modo}`;

/** Los logros fijos por idioma: [id, nombre, modo, tipo (eps | pelis | series), objetivo, recompensa, dificultad]. */
const LOGROS = [
    ["plex_en_eps_10", "Do you speak English?", "ingles", "eps", 10, 300, "facil"],
    ["plex_en_eps_100", "Binge in English", "ingles", "eps", 100, 1500, "normal"],
    ["plex_en_eps_500", "Native speaker", "ingles", "eps", 500, 6000, "gordo"],
    ["plex_en_pelis_5", "Hollywood sin doblaje", "ingles", "pelis", 5, 300, "facil"],
    ["plex_en_pelis_25", "Cinéfilo de versión original", "ingles", "pelis", 25, 1500, "normal"],
    ["plex_en_pelis_100", "Óscar a la versión original", "ingles", "pelis", 100, 6000, "gordo"],
    ["plex_en_series_1", "The End", "ingles", "series", 1, 1000, "normal"],
    ["plex_en_series_5", "Bilingüe de sofá", "ingles", "series", 5, 5000, "gordo"],
    ["plex_vose_eps_10", "Leyendo abajo", "vose", "eps", 10, 300, "facil"],
    ["plex_vose_eps_100", "Ojos de lince", "vose", "eps", 100, 1500, "normal"],
    ["plex_vose_eps_500", "Lector compulsivo", "vose", "eps", 500, 6000, "gordo"],
    ["plex_vose_pelis_5", "VOSE de domingo", "vose", "pelis", 5, 300, "facil"],
    ["plex_vose_pelis_25", "Cineclub", "vose", "pelis", 25, 1500, "normal"],
    ["plex_vose_series_1", "Subtitulado de principio a fin", "vose", "series", 1, 1000, "normal"],
    ["plex_vose_series_5", "Maestro del subtítulo", "vose", "series", 5, 5000, "gordo"],
    ["plex_en_puro_eps_25", "Sin red", "ingles_sin_subs", "eps", 25, 1200, "normal"],
    ["plex_en_puro_eps_250", "Oído de nativo", "ingles_sin_subs", "eps", 250, 6000, "gordo"],
    ["plex_en_puro_pelis_10", "Sin subtítulos, sin miedo", "ingles_sin_subs", "pelis", 10, 1200, "normal"],
    ["plex_en_puro_series_1", "Ni un subtítulo", "ingles_sin_subs", "series", 1, 4000, "gordo"],
    ["plex_es_eps_10", "Doblaje de casa", "castellano", "eps", 10, 200, "facil"],
    ["plex_es_eps_100", "Voces de siempre", "castellano", "eps", 100, 1000, "normal"],
    ["plex_es_eps_500", "Fan del doblaje", "castellano", "eps", 500, 4000, "gordo"],
    ["plex_es_pelis_5", "Sesión de tarde", "castellano", "pelis", 5, 200, "facil"],
    ["plex_es_pelis_25", "Cine de sobremesa", "castellano", "pelis", 25, 1000, "normal"],
    ["plex_es_pelis_100", "Sobremesa eterna", "castellano", "pelis", 100, 4000, "gordo"],
    ["plex_es_series_1", "En castellano y de principio a fin", "castellano", "series", 1, 800, "normal"],
    ["plex_es_series_5", "Doblaje de oro", "castellano", "series", 5, 3500, "gordo"],
    ["plex_anime_es_eps_12", "Sábado por la mañana", "anime_castellano", "eps", 12, 300, "facil"],
    ["plex_anime_es_eps_100", "Doblaje de la infancia", "anime_castellano", "eps", 100, 1500, "normal"],
    ["plex_anime_es_eps_500", "Leyenda del doblaje", "anime_castellano", "eps", 500, 6000, "gordo"],
    ["plex_anime_es_pelis_3", "Anime en la gran pantalla", "anime_castellano", "pelis", 3, 300, "facil"],
    ["plex_anime_es_series_1", "Saga doblada", "anime_castellano", "series", 1, 1000, "normal"],
    ["plex_anime_es_series_5", "Coleccionista de doblajes", "anime_castellano", "series", 5, 5000, "gordo"],
    ["plex_anime_jpes_eps_12", "Itadakimasu", "anime_jap_sub_es", "eps", 12, 300, "facil"],
    ["plex_anime_jpes_eps_100", "Nakama del fansub", "anime_jap_sub_es", "eps", 100, 1500, "normal"],
    ["plex_anime_jpes_eps_500", "Sensei del subtítulo", "anime_jap_sub_es", "eps", 500, 6000, "gordo"],
    ["plex_anime_jpes_pelis_3", "Estreno en versión original", "anime_jap_sub_es", "pelis", 3, 300, "facil"],
    ["plex_anime_jpes_series_1", "Arigatou gozaimasu", "anime_jap_sub_es", "series", 1, 1000, "normal"],
    ["plex_anime_jpes_series_5", "Purista del anime", "anime_jap_sub_es", "series", 5, 5000, "gordo"],
    ["plex_anime_en_eps_12", "Dubbed!", "anime_ingles", "eps", 12, 300, "facil"],
    ["plex_anime_en_eps_100", "English dub squad", "anime_ingles", "eps", 100, 1500, "normal"],
    ["plex_anime_en_pelis_3", "Anime night (dubbed)", "anime_ingles", "pelis", 3, 300, "facil"],
    ["plex_anime_en_series_1", "Dub de principio a fin", "anime_ingles", "series", 1, 1000, "normal"],
    ["plex_anime_jpen_eps_12", "Subbed, not dubbed", "anime_jap_sub_en", "eps", 12, 300, "facil"],
    ["plex_anime_jpen_eps_100", "Weeb internacional", "anime_jap_sub_en", "eps", 100, 1500, "normal"],
    ["plex_anime_jpen_eps_500", "Simulcast humano", "anime_jap_sub_en", "eps", 500, 6000, "gordo"],
    ["plex_anime_jpen_pelis_3", "Anime con subs en inglés", "anime_jap_sub_en", "pelis", 3, 300, "facil"],
    ["plex_anime_jpen_series_1", "Full run, English subs", "anime_jap_sub_en", "series", 1, 1000, "normal"],
    ["plex_anime_jp_puro_eps_12", "Ni falta que hace", "anime_jap_sin_subs", "eps", 12, 1500, "normal"],
    ["plex_anime_jp_puro_eps_100", "Nativo de Akihabara", "anime_jap_sin_subs", "eps", 100, 6000, "gordo"],
    ["plex_anime_jp_puro_series_1", "Japonés nivel N1", "anime_jap_sin_subs", "series", 1, 5000, "gordo"],
];

const DESCRIPCION = {
    eps: (n, m) => `Ve ${n} episodios distintos ${m.anime ? "de anime " : ""}${m.texto}`,
    pelis: (n, m) => `Ve ${n} películas distintas ${m.anime ? "de anime " : ""}${m.texto}`,
    series: (n, m) =>
        n === 1
            ? `Termina una serie ${m.anime ? "de anime " : ""}entera ${m.texto}`
            : `Termina ${n} series ${m.anime ? "de anime " : ""}enteras ${m.texto}`,
};

/** Los logros fijos por idioma, como entradas del catálogo de achievementsSystem (categoría plex). */
function logrosFijos() {
    return LOGROS.map(([id, name, modo, tipo, target, rewardCoins, dificultad]) => ({
        id,
        name,
        desc: DESCRIPCION[tipo](target, MODOS[modo]),
        category: "plex",
        event: evento(tipo, modo),
        metric: "max",
        target,
        rewardCoins,
        dificultad,
        emoji: MODOS[modo].emoji,
    }));
}

// ─── Idioma de cada reproducción ─────────────────────────────────────────────
/** Código de un idioma por su código (spa, eng, jpn, es-ES...) o su nombre en español o inglés. */
function codigoIdioma(codigo, nombre) {
    const c = normalizar(codigo);
    const n = normalizar(nombre);
    if (!c && !n) return null;
    if (/latin|mexic|419|americ/.test(n) || ["es-419", "es-mx", "es-la"].includes(c)) return "lat";
    if (["spa", "es", "esp", "es-es", "cas"].includes(c) || /^(espanol|spanish|castellano)/.test(n)) return "es";
    if (["eng", "en"].includes(c) || c.startsWith("en-") || /^(english|ingles)/.test(n)) return "en";
    if (["jpn", "ja", "jp"].includes(c) || /^(japanese|japones|日本語)/.test(n)) return "ja";
    return "otro";
}

/** De los datos de get_stream_data: el audio que se oyó y los subtítulos que se vieron (no = sin subtítulos; los
 * forzados, que solo traducen carteles, no cuentan). */
function idiomaDe(datos) {
    if (!datos) return { audio: null, subs: null };
    const audio = codigoIdioma(
        datos.stream_audio_language_code || datos.audio_language_code,
        datos.stream_audio_language || datos.audio_language,
    );
    const forzados = Number(datos.stream_subtitle_forced ?? datos.subtitle_forced) === 1;
    let subs = "no";
    if (Number(datos.subtitles) === 1 && !forzados) {
        subs = codigoIdioma("", datos.stream_subtitle_language || datos.subtitle_language) || "otro";
        if (subs === "lat") subs = "es"; // los subtítulos en español cuentan igual
    }
    return { audio, subs };
}

/**
 * Pide a Tautulli el idioma de las reproducciones vistas por los vinculados que faltan (las más recientes primero), sin
 * pasarse de `presupuesto` llamadas.
 * @returns {Promise<{ llamadas: number, revisadas: number, errores: number, pendientes: number }>}
 */
async function actualizar(guildId, { presupuesto = PRESUPUESTO.cron } = {}) {
    const t0 = Date.now();
    const r = { llamadas: 0, revisadas: 0, errores: 0, pendientes: 0 };
    const usuarios = plexLinks.getLinks(guildId).map((l) => String(l.tautulliUserId));
    if (!usuarios.length || presupuesto <= 0) {
        r.pendientes = estado(guildId).pendientes;
        return r;
    }
    const lista = db
        .prepare(
            `SELECT id FROM plex_reproducciones WHERE guildId = ? AND visto = 1 AND idioma_revisado = 0
                 AND tautulliUserId IN (${usuarios.map(() => "?").join(",")})
             ORDER BY inicio DESC LIMIT ?`,
        )
        .pluck()
        .all(guildId, ...usuarios, presupuesto);
    const guardar = db.prepare("UPDATE plex_reproducciones SET audio = ?, subs = ?, idioma_revisado = 1 WHERE guildId = ? AND id = ?");
    let i = 0;
    let erroresSeguidos = 0;
    const trabajador = async () => {
        while (i < lista.length && erroresSeguidos < MAX_ERRORES_SEGUIDOS) {
            const id = lista[i++];
            r.llamadas++;
            try {
                const { audio, subs } = idiomaDe(await tautulli.getStreamData(guildId, id));
                guardar.run(audio, subs, guildId, id);
                r.revisadas++;
                erroresSeguidos = 0;
            } catch (e) {
                r.errores++;
                erroresSeguidos++;
                log.debug(`Idioma de la reproducción ${id}: ${e.message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
    if (erroresSeguidos >= MAX_ERRORES_SEGUIDOS)
        log.warn(`Idiomas de Plex de ${guildId}: Tautulli falla, se sigue en la próxima sincronización`);
    r.pendientes = estado(guildId).pendientes;
    (r.revisadas ? log.info : log.debug)(
        `Idiomas de Plex de ${guildId}: ${r.revisadas} reproducciones revisadas, ${r.pendientes} pendientes · ${Date.now() - t0} ms`,
    );
    return r;
}

/** Cuántas reproducciones vistas de los vinculados tienen el idioma y cuántas faltan. */
function estado(guildId) {
    const usuarios = plexLinks.getLinks(guildId).map((l) => String(l.tautulliUserId));
    if (!usuarios.length) return { revisadas: 0, pendientes: 0 };
    const c = db
        .prepare(
            `SELECT COALESCE(SUM(idioma_revisado = 1), 0) AS revisadas, COALESCE(SUM(idioma_revisado = 0), 0) AS pendientes
             FROM plex_reproducciones WHERE guildId = ? AND visto = 1 AND tautulliUserId IN (${usuarios.map(() => "?").join(",")})`,
        )
        .get(guildId, ...usuarios);
    return c;
}

module.exports = {
    PRESUPUESTO,
    DIFICULTADES,
    MODOS,
    LOGROS,
    textoDificultad,
    leerDificultad,
    modoPorSlug,
    modosDe,
    evento,
    logrosFijos,
    codigoIdioma,
    idiomaDe,
    actualizar,
    estado,
};
