const axios = require("axios");
const { canalesPermitidos } = require("../repositorios/canalesPermitidos");
const guildSettings = require("../systems/guildSettings");
const { createLogger, registerSecret } = require("../core/logger");
const log = createLogger("Seerr");

// Lista vacía = sin restricción. En cuanto se añade un canal, la lista pasa a ser
// una allowlist: solo esos canales pueden pedir/buscar contenido en Seerr.
const canales = canalesPermitidos("seerr");
const getAllowedChannels = canales.todos;
const addAllowedChannel = (guildId, channelId, channelName) => void canales.agregar(guildId, channelId, channelName);
const removeAllowedChannel = (guildId, channelId) => void canales.quitar(guildId, channelId);
const clearAllowedChannels = (guildId) => void canales.vaciar(guildId);

function isChannelAllowed(guildId, channelId) {
    const rows = getAllowedChannels(guildId);
    if (!rows.length) return true;
    return rows.some((r) => r.channelId === channelId);
}

function getConfig(guildId) {
    const cfg = guildId ? guildSettings.getSettings(guildId).seerr : null;
    return {
        url: (cfg?.url || process.env.SEERR_URL || "").replace(/\/+$/, ""),
        apiKey: cfg?.api_key || process.env.SEERR_API_KEY || "",
        dailyRequestLimit: Number(cfg?.daily_request_limit ?? 5),
    };
}

// Axios serializa espacios como "+" por defecto (form-encoding), pero Jellyseerr valida
// que los parámetros vengan en %20 estricto y rechaza "+" con un 400 ("must be url
// encoded") — pasó de verdad buscando "Barbie 2". Serializador propio con encodeURIComponent
// (RFC3986, siempre %20) en vez de dejar que axios use su formato por defecto.
function serializeParams(params) {
    return Object.entries(params || {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
}

async function call(guildId, method, path, { params, data } = {}) {
    const { url, apiKey } = getConfig(guildId);
    if (!url || !apiKey) throw new Error("Seerr no está configurado (falta SEERR_URL/SEERR_API_KEY).");
    registerSecret(apiKey);

    const t0 = Date.now();
    let res;
    try {
        res = await axios.request({
            method,
            url: `${url}/api/v1${path}`,
            headers: { "X-Api-Key": apiKey },
            params,
            paramsSerializer: serializeParams,
            data,
            timeout: 10000,
            validateStatus: () => true,
        });
    } catch (e) {
        log.warn(`${method.toUpperCase()} ${path} sin respuesta tras ${Date.now() - t0} ms: ${e.code || ""} ${e.message}`);
        throw e;
    }

    const ms = Date.now() - t0;
    if (res.status >= 400) {
        const message = res.data?.message || res.data?.error || `HTTP ${res.status}`;
        log.warn(`${method.toUpperCase()} ${path} → ${res.status} (${ms} ms): ${message}`);
        const err = new Error(`Seerr respondió con error en ${method} ${path}: ${message}`);
        err.status = res.status;
        err.seerrMessage = message;
        throw err;
    }
    log.debug(`${method.toUpperCase()} ${path} → ${res.status} (${ms} ms)`);
    return res.data;
}

// El estado de la PETICIÓN (distinto del estado del título en Plex): 1 pendiente de aprobación, 2 aprobada, 3 rechazada.
const PETICION_PENDIENTE = 1;
const PETICION_RECHAZADA = 3;

const STATUS_LABELS = {
    1: "sin solicitar",
    2: "pendiente de aprobación",
    3: "procesando (descargando)",
    4: "parcialmente disponible",
    5: "disponible",
};

function statusLabel(status) {
    return STATUS_LABELS[Number(status)] || "desconocido";
}

/**
 * El texto de una búsqueda sin caracteres reservados. Seerr lo reenvía a TMDB, que rechaza con 400 los títulos con ":",
 * "&", "#", "/" o "'" ("Star Wars: Episode IV", "Tom & Jerry"). Se quitan: la búsqueda sigue encontrando el título.
 */
function textoDeBusqueda(texto) {
    return String(texto ?? "")
        .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function searchMulti(guildId, query, page = 1) {
    const texto = textoDeBusqueda(query);
    if (!texto) return [];
    const data = await call(guildId, "get", "/search", { params: { query: texto, page, language: "es" } });
    return (data?.results || [])
        .filter((r) => r.mediaType === "movie" || r.mediaType === "tv")
        .map((r) => ({
            tmdbId: r.id,
            mediaType: r.mediaType,
            titulo: r.mediaType === "movie" ? r.title : r.name,
            anyo: (r.releaseDate || r.firstAirDate || "").slice(0, 4) || null,
            sinopsis: r.overview ? String(r.overview).slice(0, 400) : null,
            estado: statusLabel(r.mediaInfo?.status),
            estadoCodigo: r.mediaInfo?.status || 1,
        }));
}

async function testConnection(guildId) {
    try {
        const data = await call(guildId, "get", "/status");
        return { ok: true, version: data?.version };
    } catch (e) {
        log.warn("Test de conexión falló:", e.message);
        return { ok: false, error: e && e.message };
    }
}

// ─── Usuarios (para atribuir peticiones a la persona real) ────────────────
const usersCache = new Map(); // guildId -> { users, ts }
const USERS_CACHE_TTL_MS = 10 * 60 * 1000;

async function getUsersDetailed(guildId, { forceRefresh = false } = {}) {
    const cached = usersCache.get(guildId);
    if (!forceRefresh && cached && Date.now() - cached.ts < USERS_CACHE_TTL_MS) return cached.users;

    const list = await call(guildId, "get", "/user", { params: { take: 100 } });
    const basics = list?.results || [];
    const details = await Promise.all(basics.map((u) => call(guildId, "get", `/user/${u.id}`).catch(() => null)));
    const users = details.filter(Boolean).map((u) => ({
        id: u.id,
        plexUsername: u.plexUsername || null,
        email: u.email || null,
        displayName: u.displayName || u.plexUsername || u.email,
        discordIds: u.settings?.discordIds || [],
    }));
    usersCache.set(guildId, { users, ts: Date.now() });
    return users;
}

async function resolveSeerrUserByDiscordId(guildId, discordId) {
    const users = await getUsersDetailed(guildId);
    return users.find((u) => (u.discordIds || []).includes(String(discordId))) || null;
}

async function resolveSeerrUserByPlexUsername(guildId, plexUsername) {
    if (!plexUsername) return null;
    const users = await getUsersDetailed(guildId);
    const target = String(plexUsername).toLowerCase();
    return users.find((u) => String(u.plexUsername || "").toLowerCase() === target) || null;
}

// ─── Caché de búsquedas recientes por canal (guardarraíl: nunca se pide un
// tmdbId que el modelo se haya inventado, solo uno que salió de una búsqueda
// real muy reciente en ese mismo canal) ─────────────────────────────────────
const searchCache = new Map(); // channelId -> { items, ts }
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;

function cacheSearchResults(channelId, items) {
    searchCache.set(channelId, { items, ts: Date.now() });
}

function getCachedSearchResult(channelId, tmdbId, mediaType) {
    const entry = searchCache.get(channelId);
    if (!entry || Date.now() - entry.ts > SEARCH_CACHE_TTL_MS) return null;
    return entry.items.find((i) => Number(i.tmdbId) === Number(tmdbId) && i.mediaType === mediaType) || null;
}

async function createRequest(guildId, { mediaType, tmdbId, seasons, userId } = {}) {
    const body = {
        mediaType,
        mediaId: Number(tmdbId),
        is4k: false,
    };
    if (mediaType === "tv") body.seasons = seasons || "all";
    if (userId) body.userId = userId;

    const result = await call(guildId, "post", "/request", { data: body });
    log.info(
        `Petición creada: ${mediaType} tmdb=${tmdbId} para el usuario de Seerr ${userId ?? "(API)"} · id petición ${result?.id ?? "?"}`,
    );
    return result;
}

/** Recomendaciones de Seerr (TMDB) para una película o serie, con la misma forma que searchMulti. */
async function recomendaciones(guildId, mediaType, tmdbId) {
    const data = await call(guildId, "get", `/${mediaType}/${Number(tmdbId)}/recommendations`, { params: { language: "es" } });
    return (data?.results || [])
        .filter((r) => r.mediaType === "movie" || r.mediaType === "tv")
        .map((r) => ({
            tmdbId: r.id,
            mediaType: r.mediaType,
            titulo: r.mediaType === "movie" ? r.title : r.name,
            anyo: (r.releaseDate || r.firstAirDate || "").slice(0, 4) || null,
            estadoCodigo: r.mediaInfo?.status || 1,
        }));
}

async function getMediaTitle(guildId, mediaType, tmdbId) {
    try {
        const data = await call(guildId, "get", `/${mediaType}/${tmdbId}`);
        return mediaType === "movie" ? data?.title : data?.name;
    } catch (e) {
        log.debug(`No se pudo obtener el título de ${mediaType} ${tmdbId}: ${e.message}`);
        return null;
    }
}

/** El título y el estado en Plex (estadoCodigo: 5 disponible, 4 a medias…) de una película o serie de TMDB. */
async function getMediaStatus(guildId, mediaType, tmdbId) {
    const data = await call(guildId, "get", `/${mediaType}/${Number(tmdbId)}`);
    return { titulo: (mediaType === "movie" ? data?.title : data?.name) || null, estadoCodigo: data?.mediaInfo?.status || 1 };
}

/**
 * Peticiones sin título (una sola llamada, para el aviso de "ya está en Plex", que mira muchas cada 30 min):
 * { id, mediaType, tmdbId, estadoCodigo, seerrUserId, plexUsername }.
 */
async function getRequestsRaw(guildId, { filter = "all", take = 100, sort = "modified" } = {}) {
    const data = await call(guildId, "get", "/request", { params: { filter, take, sort } });
    return (data?.results || []).map((r) => ({
        id: r.id,
        mediaType: r.type,
        tmdbId: r.media?.tmdbId,
        estadoCodigo: Number(r.media?.status) || 0,
        seerrUserId: r.requestedBy?.id ?? null,
        plexUsername: r.requestedBy?.plexUsername || null,
        estadoPeticion: Number(r.status) || 0,
    }));
}

/** Las peticiones pendientes de aprobación de una persona de Seerr, con su título (#410): { id, mediaType, tmdbId, titulo, fecha }. */
async function getPeticionesPendientesDe(guildId, seerrUserId) {
    const propias = (await getRequestsRaw(guildId, { filter: "pending", take: 100, sort: "added" })).filter(
        (p) => p.estadoPeticion === PETICION_PENDIENTE && Number(p.seerrUserId) === Number(seerrUserId),
    );
    const titulos = await Promise.all(propias.map((p) => getMediaTitle(guildId, p.mediaType, p.tmdbId)));
    return propias.map((p, i) => ({ id: p.id, mediaType: p.mediaType, tmdbId: p.tmdbId, titulo: titulos[i] || `(tmdb ${p.tmdbId})` }));
}

/** Borra una petición de Seerr (#410). */
async function cancelarPeticion(guildId, requestId) {
    await call(guildId, "delete", `/request/${Number(requestId)}`);
    log.info(`Petición ${requestId} cancelada`);
}

/**
 * Estrenos entre dos días «AAAA-MM-DD» (#299): lo que Seerr da en «próximamente» (películas y series), con póster y fecha, de la
 * fecha más próxima a la más lejana. { tmdbId, mediaType, titulo, fecha, poster, estadoCodigo }.
 */
async function getEstrenos(guildId, desde, hasta) {
    const peticiones = [
        call(guildId, "get", "/discover/movies/upcoming", {
            params: { page: 1, language: "es", primaryReleaseDateGte: desde, primaryReleaseDateLte: hasta },
        }),
        call(guildId, "get", "/discover/tv/upcoming", {
            params: { page: 1, language: "es", firstAirDateGte: desde, firstAirDateLte: hasta },
        }),
    ];
    const [peliculas, series] = await Promise.all(peticiones);
    return [...(peliculas?.results || []), ...(series?.results || [])]
        .map((r) => {
            const tipo = r.mediaType || (r.title ? "movie" : "tv");
            return {
                tmdbId: r.id,
                mediaType: tipo,
                titulo: tipo === "movie" ? r.title : r.name,
                fecha: (r.releaseDate || r.firstAirDate || "").slice(0, 10),
                poster: r.posterPath ? `https://image.tmdb.org/t/p/w342${r.posterPath}` : null,
                estadoCodigo: r.mediaInfo?.status || 1,
            };
        })
        .filter((e) => e.titulo && e.fecha >= desde && e.fecha <= hasta)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.titulo.localeCompare(b.titulo));
}

async function getRequests(guildId, { filter = "all", take = 10, sort = "added" } = {}) {
    const data = await call(guildId, "get", "/request", { params: { filter, take, sort } });
    const results = data?.results || [];
    const titulos = await Promise.all(results.map((r) => getMediaTitle(guildId, r.type, r.media?.tmdbId)));
    return results.map((r, idx) => ({
        id: r.id,
        estado: statusLabel(r.media?.status),
        tipo: r.type,
        titulo: titulos[idx] || `(tmdb ${r.media?.tmdbId})`,
        pedidoPor: r.requestedBy?.displayName || r.requestedBy?.plexUsername || "desconocido",
        fecha: r.createdAt ? r.createdAt.slice(0, 10) : null,
    }));
}

module.exports = {
    getConfig,
    searchMulti,
    recomendaciones,
    testConnection,
    getUsersDetailed,
    resolveSeerrUserByDiscordId,
    resolveSeerrUserByPlexUsername,
    cacheSearchResults,
    getCachedSearchResult,
    createRequest,
    getRequests,
    getRequestsRaw,
    getPeticionesPendientesDe,
    cancelarPeticion,
    getEstrenos,
    PETICION_PENDIENTE,
    PETICION_RECHAZADA,
    getMediaTitle,
    getMediaStatus,

    getAllowedChannels,
    addAllowedChannel,
    removeAllowedChannel,
    clearAllowedChannels,
    isChannelAllowed,
};
