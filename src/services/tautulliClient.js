const axios = require("axios");
const db = require("../core/db");
const guildSettings = require("../systems/guildSettings");
const { createLogger, registerSecret } = require("../core/logger");
const log = createLogger("Tautulli");

// Lista vacía = sin restricción (Plex disponible en cualquier canal). En cuanto se añade
// un canal, la lista pasa a ser una allowlist: solo esos canales pueden usar las tools de Plex.
function getAllowedChannels(guildId) {
    return db.prepare(`SELECT channelId, channelName FROM plex_allowed_channels WHERE guildId = ? ORDER BY channelName ASC`).all(guildId);
}

function addAllowedChannel(guildId, channelId, channelName) {
    db.prepare(
        `
        INSERT INTO plex_allowed_channels (guildId, channelId, channelName)
        VALUES (?, ?, ?)
        ON CONFLICT(guildId, channelId) DO UPDATE SET channelName = excluded.channelName
    `,
    ).run(guildId, channelId, channelName || null);
}

function removeAllowedChannel(guildId, channelId) {
    db.prepare(`DELETE FROM plex_allowed_channels WHERE guildId = ? AND channelId = ?`).run(guildId, channelId);
}

function clearAllowedChannels(guildId) {
    db.prepare(`DELETE FROM plex_allowed_channels WHERE guildId = ?`).run(guildId);
}

function isChannelAllowed(guildId, channelId) {
    const rows = getAllowedChannels(guildId);
    if (!rows.length) return true; // sin lista = sin restricción
    return rows.some((r) => r.channelId === channelId);
}

function getConfig(guildId) {
    const cfg = guildId ? guildSettings.getSettings(guildId).plex : null;
    return {
        url: (cfg?.tautulli_url || process.env.TAUTULLI_URL || "").replace(/\/+$/, ""),
        apiKey: cfg?.tautulli_api_key || process.env.TAUTULLI_API_KEY || "",
    };
}

async function call(guildId, cmd, params = {}, { timeout = 10000 } = {}) {
    const { url, apiKey } = getConfig(guildId);
    if (!url || !apiKey) throw new Error("Tautulli no está configurado (falta TAUTULLI_URL/TAUTULLI_API_KEY).");

    registerSecret(apiKey);

    const t0 = Date.now();
    let res;
    try {
        res = await axios.get(`${url}/api/v2`, {
            params: { apikey: apiKey, cmd, ...params },
            timeout,
        });
    } catch (e) {
        log.warn(
            `${cmd} falló tras ${Date.now() - t0} ms: ${e.response?.status ? `HTTP ${e.response.status}` : e.code || ""} ${e.message}`,
        );
        throw e;
    }

    const response = res.data?.response;
    if (!response || response.result !== "success") {
        log.warn(`${cmd} respondió con error (${Date.now() - t0} ms): ${response?.message || "desconocido"}`);
        const error = new Error(`Tautulli respondió con error en ${cmd}: ${response?.message || "desconocido"}`);
        // Tautulli contestó, pero con un error (no es un fallo de red ni un timeout).
        error.respuestaDeTautulli = true;
        throw error;
    }
    log.debug(`${cmd} ok (${Date.now() - t0} ms)`);
    return response.data;
}

async function getUsers(guildId) {
    const data = await call(guildId, "get_users");
    return (data || []).filter((u) => u.user_id !== 0); // descarta el usuario "Local"
}

async function getHistory(guildId, { userId, afterDate, length = 50 } = {}) {
    const params = { length };
    if (userId) params.user_id = userId;
    if (afterDate) params.after = afterDate;
    const data = await call(guildId, "get_history", params);
    return data?.data || [];
}

/**
 * Una página del historial sin agrupar (cada reproducción por separado), de la más reciente a la más antigua.
 * `after`: solo lo posterior a esa fecha (AAAA-MM-DD). Para copiar el historial entero a la BD (systems/plexHistorial).
 */
async function getHistoryPage(guildId, { start = 0, length = 1000, after = null } = {}) {
    const params = { start, length, grouping: 0, order_column: "date", order_dir: "desc" };
    if (after) params.after = after;
    const data = await call(guildId, "get_history", params);
    return data?.data || [];
}

/** La ficha de una película, serie, temporada o episodio (géneros, directores, colecciones, biblioteca...). Si Plex ya
 * no lo tiene, Tautulli responde con un objeto vacío o con un error: aquí, null. Un fallo de red sí se lanza. */
async function getMetadata(guildId, ratingKey) {
    let data;
    try {
        data = await call(guildId, "get_metadata", { rating_key: ratingKey });
    } catch (e) {
        if (e.respuestaDeTautulli) return null;
        throw e;
    }
    return data && data.rating_key ? data : null;
}

/** Los hijos de un elemento: las temporadas de una serie o los episodios de una temporada (con su media_index). */
async function getChildrenMetadata(guildId, ratingKey, mediaType) {
    const data = await call(guildId, "get_children_metadata", { rating_key: ratingKey, media_type: mediaType });
    return data?.children_list || [];
}

/** Una página de lo que hay en una biblioteca (rating_key, título y año de cada película). Tarda la primera vez. */
async function getLibraryMediaInfo(guildId, sectionId, { start = 0, length = 1000 } = {}) {
    const data = await call(
        guildId,
        "get_library_media_info",
        { section_id: sectionId, start, length, order_column: "sort_title", order_dir: "asc" },
        { timeout: 60000 },
    );
    return { filas: data?.data || [], total: Number(data?.recordsFiltered ?? data?.recordsTotal ?? 0) };
}

async function getUserWatchTimeStats(guildId, userId, queryDays = "7,30,0") {
    const data = await call(guildId, "get_user_watch_time_stats", { user_id: userId, query_days: queryDays });
    return data || [];
}

async function getActivity(guildId) {
    const data = await call(guildId, "get_activity");
    return data?.sessions || [];
}

async function getRecentlyAdded(guildId, count = 5) {
    const data = await call(guildId, "get_recently_added", { count });
    return data?.recently_added || [];
}

async function getLibraries(guildId) {
    const data = await call(guildId, "get_libraries");
    return data || [];
}

async function search(guildId, query) {
    const data = await call(guildId, "search", { query });
    return data?.results_list || {};
}

async function getHomeStats(guildId, timeRange = 30, statsCount = 5) {
    const data = await call(guildId, "get_home_stats", { time_range: timeRange, stats_count: statsCount });
    return data || [];
}

async function getPlaysByTopUsers(guildId, timeRange = 30) {
    const data = await call(guildId, "get_plays_by_top_10_users", { time_range: timeRange });
    return data || { categories: [], series: [] };
}

async function getPlaysByDayOfWeek(guildId, timeRange = 30) {
    const data = await call(guildId, "get_plays_by_dayofweek", { time_range: timeRange });
    return data || { categories: [], series: [] };
}

async function getPlaysByHourOfDay(guildId, timeRange = 30) {
    const data = await call(guildId, "get_plays_by_hourofday", { time_range: timeRange });
    return data || { categories: [], series: [] };
}

async function testConnection(guildId) {
    try {
        const users = await getUsers(guildId);
        return { ok: true, userCount: users.length };
    } catch (e) {
        log.warn("Test de conexión falló:", e.message);
        return { ok: false, error: e && e.message };
    }
}

// ─── Canal de novedades automático ─────────────────────────────────────────
function getLastAddedAt(guildId) {
    const row = db.prepare(`SELECT lastAddedAt FROM plex_novedades_state WHERE guildId = ?`).get(guildId);
    return row ? Number(row.lastAddedAt) : 0;
}

function setLastAddedAt(guildId, ts) {
    db.prepare(
        `
        INSERT INTO plex_novedades_state (guildId, lastAddedAt) VALUES (?, ?)
        ON CONFLICT(guildId) DO UPDATE SET lastAddedAt = excluded.lastAddedAt
    `,
    ).run(guildId, ts);
}

async function checkAllGuildsForNewContent(client) {
    for (const guild of client.guilds.cache.values()) {
        const channelId = guildSettings.getSettings(guild.id).plex.novedades_channel_id;
        if (!channelId) continue;

        try {
            const items = await getRecentlyAdded(guild.id, 15);
            if (!items.length) continue;
            const maxAddedAt = Math.max(...items.map((i) => Number(i.added_at) || 0));
            const lastSeen = getLastAddedAt(guild.id);

            // Primera vez que se comprueba este guild: fija la base sin avisar de todo
            // lo que ya había en la biblioteca antes de configurar el canal.
            if (lastSeen === 0) {
                setLastAddedAt(guild.id, maxAddedAt);
                log.info(`Novedades: primera comprobación en ${guild.name}, se fija la base sin publicar nada`);
                continue;
            }

            const nuevos = items.filter((i) => Number(i.added_at) > lastSeen).sort((a, b) => Number(a.added_at) - Number(b.added_at));
            if (!nuevos.length) continue;

            const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
            if (!channel || !channel.isTextBased()) {
                log.warn(
                    `Novedades: el canal ${channelId} de ${guild.name} no existe o no es de texto; ${nuevos.length} novedades sin publicar`,
                );
            } else {
                log.info(`Novedades: ${nuevos.length} nuevas en ${guild.name}, publicando en #${channel.name}`);
                for (const item of nuevos) {
                    const titulo = item.grandparent_title ? `${item.grandparent_title} — ${item.title}` : item.title;
                    const tipo = item.media_type === "episode" ? "📺" : item.media_type === "movie" ? "🎬" : "🎞️";
                    try {
                        await channel.send(`${tipo} **Nuevo en Plex:** ${titulo}${item.year ? ` (${item.year})` : ""}`);
                    } catch (e) {
                        log.warn(`No se pudo publicar la novedad "${titulo}" en ${guild.name}:`, e.message);
                    }
                }
            }
            setLastAddedAt(guild.id, maxAddedAt);
        } catch (e) {
            log.warn(`Error comprobando novedades para ${guild.name}:`, e.message);
        }
    }
}

module.exports = {
    getConfig,
    getUsers,
    getHistory,
    getHistoryPage,
    getMetadata,
    getChildrenMetadata,
    getLibraryMediaInfo,
    getUserWatchTimeStats,
    getActivity,
    getRecentlyAdded,
    getLibraries,
    search,
    getHomeStats,
    getPlaysByTopUsers,
    getPlaysByDayOfWeek,
    getPlaysByHourOfDay,
    testConnection,
    checkAllGuildsForNewContent,
    getAllowedChannels,
    addAllowedChannel,
    removeAllowedChannel,
    clearAllowedChannels,
    isChannelAllowed,
};
