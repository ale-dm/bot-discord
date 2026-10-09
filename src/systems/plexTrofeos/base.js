// 🍿 Trofeos de Plex: constantes (umbrales, recompensas, dificultades, emojis) y utilidades que usan las demás partes.
const plexFichas = require("../plexFichas");
const plexIdiomas = require("../plexIdiomas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Plex");
const { normalizar, clavePelicula } = plexFichas;
const PREFIJO = "plext:";
/** Nombres pedidos a Gemini por sincronización (la primera importación puede crear cientos) y por llamada. */
const MAX_NOMBRES_IA = 150;
const LOTE_IA = 40;
const DIRECTOR_MIN_PELICULAS = 3;
const SAGA = { min: 2, max: 40 };
const UMBRALES_GENERO = [10, 25];
const UMBRALES_PAIS = [5, 10];
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
    pais: { 5: 250, 10: 600 },
    decada: 400,
    idioma: (episodios) => Math.min(2000, 300 + 15 * episodios),
};
/** Dificultad de cada trofeo automático: lo largo que es (episodios o películas). */
const DIFICULTAD = {
    temporada: () => "facil",
    serie: (episodios) => (episodios >= 100 ? "gordo" : "normal"),
    idioma: (episodios) => (episodios >= 100 ? "gordo" : "normal"),
    saga: (peliculas) => (peliculas >= 8 ? "gordo" : "normal"),
    director: (peliculas) => (peliculas >= 10 ? "gordo" : "normal"),
    genero: (umbral) => (umbral >= 25 ? "normal" : "facil"),
    pais: (umbral) => (umbral >= 10 ? "normal" : "facil"),
    decada: () => "normal",
};
/** La de un trofeo guardado antes de que hubiera dificultades (sin el número de episodios): por su tipo. */
function dificultadGuardada(t) {
    if (plexIdiomas.DIFICULTADES[t.dificultad]) return t.dificultad;
    if (t.tipo === "temporada") return "facil";
    if (t.tipo === "genero") return /:10$/.test(t.id) ? "facil" : "normal";
    if (t.tipo === "pais") return /:5$/.test(t.id) ? "facil" : "normal";
    return "normal";
}
const EMOJI = { temporada: "📺", serie: "📺", saga: "🎬", director: "🎥", genero: "🎭", pais: "🌍", decada: "📼", admin: "🏆" };
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

module.exports = {
    log,
    normalizar,
    clavePelicula,
    PREFIJO,
    MAX_NOMBRES_IA,
    LOTE_IA,
    DIRECTOR_MIN_PELICULAS,
    SAGA,
    UMBRALES_GENERO,
    UMBRALES_PAIS,
    DECADA,
    EVENTOS_FICHAS,
    RECOMPENSA,
    DIFICULTAD,
    dificultadGuardada,
    EMOJI,
    slug,
    GENERO_CANONICO,
    canonico,
    NOMBRE_GENERO,
};
