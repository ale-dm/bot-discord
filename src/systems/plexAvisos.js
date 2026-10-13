// Avisos personales de Plex por DM, desde /plex:
//   📺 Seguir una serie (#465): cuando entra en Plex un episodio (o una temporada) de una serie que sigues, te llega un
//      DM con todo lo nuevo de esa tanda. Se mira lo añadido hace poco en Tautulli y solo cuenta lo que entra después de
//      empezar a seguirla; cada cosa se avisa una sola vez (plex_avisos_series).
//   📝 Quiero ver (#466): una lista de películas y series por id de TMDB (el de Seerr). Cuando una llega a Plex (Seerr la
//      da por disponible, o a medias si es una serie con episodios), se marca y se avisa por DM una sola vez.
// Los dos los revisa el cron de novedades de Plex (cada 30 min, core/tareas.js). Un DM que no llega (DMs cerrados) se
// apunta en el log y no para lo demás. Tablas en la migración 044.
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const tautulliClient = require("../services/tautulliClient");
const seerrClient = require("../services/seerrClient");
const { enviarAviso } = require("./avisosDm");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex").child("Avisos");

/** Como mucho, para que cada lista quepa entera en un menú de Discord (25 opciones). */
const MAX_SEGUIDAS = 25;
const MAX_QUIERO_VER = 25;
/** Lo añadido hace poco que se pide a Tautulli en cada revisión. */
const RECIENTES = 50;
/** Títulos de «quiero ver» que se consultan en Seerr por revisión (una llamada cada uno). */
const CONSULTAS_SEERR = 40;
const DISPONIBLE = 5;
const PARCIAL = 4;

const ahoraS = () => Math.floor(Date.now() / 1000);

// ─── 📺 Series seguidas ─────────────────────────────────────────────────────────

function seguidas(guildId, userId) {
    return db
        .prepare(
            "SELECT serie_key, titulo, creado_en FROM plex_series_seguidas WHERE guildId = ? AND userId = ? ORDER BY titulo COLLATE NOCASE",
        )
        .all(guildId, String(userId));
}

/** Las series que ha visto alguien en Plex y aún no sigue, de la vista más recientemente a la que menos (como mucho 25). */
function seriesParaSeguir(guildId, userId) {
    const link = plexLinks.getLinkByDiscordId(guildId, String(userId));
    if (!link) return [];
    return db
        .prepare(
            `SELECT serie_key, MAX(serie) AS titulo FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'episode' AND serie_key IS NOT NULL AND serie IS NOT NULL
               AND serie_key NOT IN (SELECT serie_key FROM plex_series_seguidas WHERE guildId = ? AND userId = ?)
             GROUP BY serie_key ORDER BY MAX(inicio) DESC LIMIT 25`,
        )
        .all(guildId, String(link.tautulliUserId), guildId, String(userId));
}

/** Empieza a seguir una serie (por su rating_key de Plex). Solo se avisa de lo que entre a partir de ahora. */
function seguir(guildId, userId, serieKey, titulo) {
    const yaLaSigue = db
        .prepare("SELECT 1 FROM plex_series_seguidas WHERE guildId = ? AND userId = ? AND serie_key = ?")
        .get(guildId, String(userId), String(serieKey));
    if (yaLaSigue) return { ok: false, motivo: `Ya sigues **${titulo}**.` };
    if (seguidas(guildId, userId).length >= MAX_SEGUIDAS)
        return { ok: false, motivo: `Ya sigues ${MAX_SEGUIDAS} series, que es el máximo. Deja de seguir alguna antes.` };
    db.prepare("INSERT INTO plex_series_seguidas (guildId, userId, serie_key, titulo, creado_en) VALUES (?, ?, ?, ?, ?)").run(
        guildId,
        String(userId),
        String(serieKey),
        String(titulo).slice(0, 200),
        ahoraS(),
    );
    return { ok: true };
}

function dejarDeSeguir(guildId, userId, serieKey) {
    return (
        db
            .prepare("DELETE FROM plex_series_seguidas WHERE guildId = ? AND userId = ? AND serie_key = ?")
            .run(guildId, String(userId), String(serieKey)).changes > 0
    );
}

/**
 * Lo añadido a Plex (get_recently_added de Tautulli) que es de una serie: { serieKey, ratingKey, addedAt, texto }, o null
 * si es otra cosa (una película). Plex agrupa a veces varios episodios en su temporada, o en la serie entera.
 */
function novedadDeSerie(item) {
    const addedAt = Number(item.added_at) || 0;
    const ratingKey = String(item.rating_key || "");
    if (!ratingKey || !addedAt) return null;
    if (item.media_type === "episode" && item.grandparent_rating_key) {
        const temporada = Number(item.parent_media_index);
        const episodio = Number(item.media_index);
        const codigo = temporada && episodio ? ` T${temporada}E${episodio}` : "";
        return {
            serieKey: String(item.grandparent_rating_key),
            ratingKey,
            addedAt,
            texto: `**${item.grandparent_title}**${codigo}${item.title ? ` · ${item.title}` : ""}`,
        };
    }
    if (item.media_type === "season" && item.parent_rating_key)
        return {
            serieKey: String(item.parent_rating_key),
            ratingKey,
            addedAt,
            texto: `**${item.parent_title}** · ${item.title} (episodios nuevos)`,
        };
    if (item.media_type === "show") return { serieKey: ratingKey, ratingKey, addedAt, texto: `**${item.title}** (episodios nuevos)` };
    return null;
}

/**
 * Qué avisar a cada uno con lo añadido hace poco: userId → [textos], sin lo ya avisado ni lo que entró antes de que
 * empezara a seguir la serie. Marca como avisado lo que devuelve (antes de mandar el DM: un fallo no se repite).
 */
function pendientesDeSeries(guildId, items) {
    const novedades = items.map(novedadDeSerie).filter(Boolean);
    if (!novedades.length) return new Map();
    const seguidores = db.prepare("SELECT userId, creado_en FROM plex_series_seguidas WHERE guildId = ? AND serie_key = ?");
    const yaAvisado = db.prepare("SELECT 1 FROM plex_avisos_series WHERE guildId = ? AND userId = ? AND rating_key = ?");
    const marcar = db.prepare("INSERT OR IGNORE INTO plex_avisos_series (guildId, userId, rating_key, avisado_en) VALUES (?, ?, ?, ?)");
    const porUsuario = new Map();
    db.transaction(() => {
        for (const n of novedades.sort((a, b) => a.addedAt - b.addedAt)) {
            for (const s of seguidores.all(guildId, n.serieKey)) {
                if (n.addedAt <= s.creado_en || yaAvisado.get(guildId, s.userId, n.ratingKey)) continue;
                marcar.run(guildId, s.userId, n.ratingKey, ahoraS());
                if (!porUsuario.has(s.userId)) porUsuario.set(s.userId, []);
                porUsuario.get(s.userId).push(n.texto);
            }
        }
    })();
    return porUsuario;
}

function textoAvisoSeries(guildName, textos) {
    const lista = textos.slice(0, 15).map((t) => `• ${t}`);
    if (textos.length > 15) lista.push(`• …y ${textos.length - 15} más`);
    return `📺 **Nuevo en Plex** de las series que sigues en ${guildName}:\n${lista.join("\n")}\n\nPara dejar de seguir una serie: /plex → 📺 Series.`;
}

/** Avisa por DM de los episodios nuevos de las series seguidas. @returns {Promise<number>} DMs enviados */
async function avisarSeries(client) {
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        const haySeguidas = db.prepare("SELECT 1 FROM plex_series_seguidas WHERE guildId = ? LIMIT 1").get(guild.id);
        if (!haySeguidas) continue;
        const { url, apiKey } = tautulliClient.getConfig(guild.id);
        if (!url || !apiKey) continue;
        let items;
        try {
            items = await tautulliClient.getRecentlyAdded(guild.id, RECIENTES);
        } catch (e) {
            log.warn(`No se pudo mirar lo añadido a Plex en ${guild.name}: ${e.message}`);
            continue;
        }
        for (const [userId, textos] of pendientesDeSeries(guild.id, items)) {
            if (await enviarAviso(client, userId, "plex_series", { content: textoAvisoSeries(guild.name, textos) })) enviados++;
            else log.info(`Series seguidas: no se pudo avisar a ${userId} por DM (${textos.length} novedades); ¿DMs cerrados?`);
        }
    }
    return enviados;
}

// ─── 📝 Quiero ver ────────────────────────────────────────────────────────────

function quieroVer(guildId, userId) {
    return db
        .prepare(
            `SELECT media_type, tmdb_id, titulo, anio, creado_en, disponible_en FROM plex_quiero_ver
             WHERE guildId = ? AND userId = ? ORDER BY disponible_en IS NULL, titulo COLLATE NOCASE`,
        )
        .all(guildId, String(userId));
}

/**
 * Añade un título a la lista (puede no estar aún en Plex: es la idea). Se pregunta a Seerr el título y si ya está:
 * lo que ya está en Plex no se añade.
 */
async function anadirQuieroVer(guildId, userId, mediaType, tmdbId) {
    if (mediaType !== "movie" && mediaType !== "tv") return { ok: false, motivo: "Eso no es una película ni una serie." };
    const yaEsta = db
        .prepare("SELECT titulo FROM plex_quiero_ver WHERE guildId = ? AND userId = ? AND media_type = ? AND tmdb_id = ?")
        .get(guildId, String(userId), mediaType, Number(tmdbId));
    if (yaEsta) return { ok: false, motivo: `**${yaEsta.titulo}** ya está en tu lista.` };
    if (quieroVer(guildId, userId).length >= MAX_QUIERO_VER)
        return { ok: false, motivo: `Tu lista ya tiene ${MAX_QUIERO_VER} títulos, que es el máximo. Quita alguno antes.` };
    let info;
    try {
        info = await seerrClient.getMediaStatus(guildId, mediaType, tmdbId);
    } catch (e) {
        return { ok: false, motivo: `No se pudo consultar Seerr: ${e.message}` };
    }
    const titulo = info.titulo || `TMDB ${tmdbId}`;
    if (info.estadoCodigo === DISPONIBLE) return { ok: false, motivo: `**${titulo}** ya está en Plex: ¡a verla!` };
    db.prepare("INSERT INTO plex_quiero_ver (guildId, userId, media_type, tmdb_id, titulo, creado_en) VALUES (?, ?, ?, ?, ?, ?)").run(
        guildId,
        String(userId),
        mediaType,
        Number(tmdbId),
        titulo.slice(0, 200),
        ahoraS(),
    );
    return { ok: true, titulo };
}

function quitarQuieroVer(guildId, userId, mediaType, tmdbId) {
    return (
        db
            .prepare("DELETE FROM plex_quiero_ver WHERE guildId = ? AND userId = ? AND media_type = ? AND tmdb_id = ?")
            .run(guildId, String(userId), mediaType, Number(tmdbId)).changes > 0
    );
}

/** ¿Cuenta como «ha llegado a Plex»? Una película, disponible; una serie, también a medias (con episodios). */
const haLlegado = (mediaType, estadoCodigo) => estadoCodigo === DISPONIBLE || (mediaType === "tv" && estadoCodigo === PARCIAL);

/**
 * Revisa en Seerr los títulos pendientes de las listas y avisa por DM de los que han llegado (una vez: se marcan con
 * disponible_en antes de avisar). @returns {Promise<number>} DMs enviados
 */
async function avisarQuieroVer(client) {
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        const titulos = db
            .prepare(
                `SELECT media_type, tmdb_id, MAX(titulo) AS titulo FROM plex_quiero_ver WHERE guildId = ? AND disponible_en IS NULL
                 GROUP BY media_type, tmdb_id ORDER BY MIN(creado_en) LIMIT ?`,
            )
            .all(guild.id, CONSULTAS_SEERR);
        if (!titulos.length) continue;
        const { url, apiKey } = seerrClient.getConfig(guild.id);
        if (!url || !apiKey) continue;
        for (const t of titulos) {
            let info;
            try {
                info = await seerrClient.getMediaStatus(guild.id, t.media_type, t.tmdb_id);
            } catch (e) {
                log.warn(`Quiero ver: no se pudo consultar ${t.titulo} en Seerr (${guild.name}): ${e.message}`);
                break;
            }
            if (!haLlegado(t.media_type, info.estadoCodigo)) continue;
            const quienes = db
                .prepare(
                    "SELECT userId FROM plex_quiero_ver WHERE guildId = ? AND media_type = ? AND tmdb_id = ? AND disponible_en IS NULL",
                )
                .pluck()
                .all(guild.id, t.media_type, t.tmdb_id);
            db.prepare(
                "UPDATE plex_quiero_ver SET disponible_en = ? WHERE guildId = ? AND media_type = ? AND tmdb_id = ? AND disponible_en IS NULL",
            ).run(ahoraS(), guild.id, t.media_type, t.tmdb_id);
            const contenido =
                `🍿 **${t.titulo}** ya está en Plex (${guild.name}). Estaba en tu lista de «quiero ver».` +
                (info.estadoCodigo === PARCIAL ? " De momento hay algunos episodios." : "");
            for (const userId of quienes) {
                if (await enviarAviso(client, userId, "plex_quiero_ver", { content: contenido })) enviados++;
                else log.info(`Quiero ver: no se pudo avisar a ${userId} de ${t.titulo} por DM; ¿DMs cerrados?`);
            }
        }
    }
    return enviados;
}

module.exports = {
    MAX_SEGUIDAS,
    MAX_QUIERO_VER,
    seguidas,
    seriesParaSeguir,
    seguir,
    dejarDeSeguir,
    novedadDeSerie,
    pendientesDeSeries,
    avisarSeries,
    quieroVer,
    anadirQuieroVer,
    quitarQuieroVer,
    haLlegado,
    avisarQuieroVer,
};
