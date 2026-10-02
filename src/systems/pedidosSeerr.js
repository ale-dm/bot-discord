// "Ya está en Plex": cuando algo pedido en Seerr pasa a estar disponible (o con episodios, en una serie a medias),
// se avisa a quien lo pidió mencionándole en el canal de novedades de Plex, o por DM si el servidor no tiene ese
// canal. Lo comprueba el cron de novedades de Plex (cada 30 min, en index.js). La persona se resuelve igual que al
// pedir: por el Discord ID de su perfil de Seerr y, si no lo tiene, por su vínculo de Plex.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const plexLinks = require("./plexLinks");
const seerrClient = require("../services/seerrClient");
const { sendDm } = require("./xp/rachas");
const { createLogger } = require("../core/logger");

const log = createLogger("Seerr");

const DISPONIBLE = 5;
const PARCIAL = 4;
// requestId reservado: el servidor ya tiene su base (ver la migración 011).
const BASE = 0;

function avisadas(guildId) {
    return new Set(
        db
            .prepare("SELECT requestId FROM seerr_avisos WHERE guildId = ?")
            .all(guildId)
            .map((r) => r.requestId),
    );
}

function marcar(guildId, ids) {
    const stmt = db.prepare("INSERT OR IGNORE INTO seerr_avisos (guildId, requestId, avisado_en) VALUES (?, ?, ?)");
    const ahora = Date.now();
    db.transaction(() => ids.forEach((id) => stmt.run(guildId, id, ahora)))();
}

async function discordIdDe(guildId, pedido) {
    let plexUsername = pedido.plexUsername;
    try {
        const usuario = (await seerrClient.getUsersDetailed(guildId)).find((u) => u.id === pedido.seerrUserId);
        if (usuario?.discordIds?.length) return String(usuario.discordIds[0]);
        plexUsername = usuario?.plexUsername || plexUsername;
    } catch (e) {
        log.debug(`No se pudieron leer los usuarios de Seerr para el aviso: ${e.message}`);
    }
    return plexLinks.getLinkByPlexUsername(guildId, plexUsername)?.discordUserId || null;
}

function texto(userId, titulo, estadoCodigo) {
    return estadoCodigo === DISPONIBLE
        ? `🍿 <@${userId}>, lo que pediste ya está en Plex: **${titulo}**.`
        : `🍿 <@${userId}>, ya hay episodios de **${titulo}** en Plex (lo pediste en Seerr; aún no está completa).`;
}

async function canalNovedades(guild) {
    const canalId = guildSettings.getSettings(guild.id).plex.novedades_channel_id;
    if (!canalId) return null;
    const canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId).catch(() => null));
    return canal?.isTextBased?.() ? canal : null;
}

/** Comprueba las peticiones de Seerr de cada servidor y avisa de las que han llegado. @returns {Promise<number>} avisos */
async function avisarDisponibles(client) {
    let avisos = 0;
    for (const guild of client.guilds.cache.values()) {
        if (!guildSettings.getSettings(guild.id).seerr.avisar_disponible) continue;
        const { url, apiKey } = seerrClient.getConfig(guild.id);
        if (!url || !apiKey) continue;
        try {
            const listos = (await seerrClient.getRequestsRaw(guild.id)).filter(
                (p) => p.estadoCodigo === DISPONIBLE || p.estadoCodigo === PARCIAL,
            );
            const ya = avisadas(guild.id);
            // Primera vez en este servidor: lo que ya estaba disponible no se avisa, solo se toma como base.
            if (!ya.has(BASE)) {
                marcar(guild.id, [BASE, ...listos.map((p) => p.id)]);
                log.info(`Avisos de pedidos: base fijada en ${guild.name} (${listos.length} ya disponibles, sin avisar)`);
                continue;
            }
            const nuevos = listos.filter((p) => !ya.has(p.id));
            if (!nuevos.length) continue;
            // Se marcan antes de avisar: un aviso que falla no se repite cada 30 minutos.
            marcar(
                guild.id,
                nuevos.map((p) => p.id),
            );
            const canal = await canalNovedades(guild);
            for (const p of nuevos) {
                const userId = await discordIdDe(guild.id, p);
                if (!userId) {
                    log.info(`Avisos de pedidos: la petición ${p.id} ya está, pero no sé de quién es en Discord`);
                    continue;
                }
                const titulo = (await seerrClient.getMediaTitle(guild.id, p.mediaType, p.tmdbId)) || "lo que pediste";
                const contenido = texto(userId, titulo, p.estadoCodigo);
                try {
                    if (canal) await canal.send({ content: contenido, allowedMentions: { users: [userId] } });
                    else if (!(await sendDm(client, userId, { content: contenido }))) continue;
                    avisos++;
                    log.info(
                        `Avisos de pedidos: ${titulo} (petición ${p.id}) avisado a ${userId}${canal ? ` en #${canal.name}` : " por DM"}`,
                    );
                } catch (e) {
                    log.warn(`No se pudo avisar de "${titulo}" a ${userId} en ${guild.name}: ${e.message}`);
                }
            }
        } catch (e) {
            log.warn(`Error comprobando los pedidos de Seerr en ${guild.name}: ${e.message}`);
        }
    }
    return avisos;
}

module.exports = { avisarDisponibles };
