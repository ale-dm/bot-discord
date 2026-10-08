// Cliente de TMDB (https://www.themoviedb.org/documentation/api): solo los países de producción de una película, para los
// trofeos por país (#19). Necesita TMDB_API_KEY en .env; sin clave no se pide nada.
const BASE_URL = "https://api.themoviedb.org/3";
const nombrePais = new Intl.DisplayNames(["es"], { type: "region" });

/** Nombre en español de un código de país (ISO 3166-1), o null si no lo conoce. */
function nombreDePais(codigo) {
    try {
        return nombrePais.of(String(codigo).toUpperCase()) || null;
    } catch {
        return null;
    }
}

/**
 * Países de producción de una película de TMDB, en español.
 * @returns {Promise<string[]|null>} la lista (vacía si TMDB no tiene la película), o null si no hay clave configurada
 */
async function paisesDePelicula(tmdbId) {
    const clave = process.env.TMDB_API_KEY || "";
    if (!clave) return null;
    const res = await fetch(`${BASE_URL}/movie/${encodeURIComponent(String(tmdbId))}?api_key=${encodeURIComponent(clave)}&language=es-ES`, {
        signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`TMDB respondió ${res.status} para la película ${tmdbId}`);
    const data = await res.json();
    return (data.production_countries || []).map((c) => nombreDePais(c.iso_3166_1) || c.name).filter(Boolean);
}

module.exports = { paisesDePelicula, nombreDePais };
