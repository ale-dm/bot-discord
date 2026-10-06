const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

function getLinks(guildId) {
    return db
        .prepare(`SELECT discordUserId, tautulliUserId, plexUsername FROM plex_links WHERE guildId = ? ORDER BY plexUsername ASC`)
        .all(guildId);
}

function getLinkByDiscordId(guildId, discordUserId) {
    return (
        db
            .prepare(`SELECT discordUserId, tautulliUserId, plexUsername FROM plex_links WHERE guildId = ? AND discordUserId = ?`)
            .get(guildId, discordUserId) || null
    );
}

function getLinkByPlexUsername(guildId, plexUsername) {
    if (!plexUsername) return null;
    return (
        db
            .prepare(
                `SELECT discordUserId, tautulliUserId, plexUsername FROM plex_links WHERE guildId = ? AND LOWER(plexUsername) = LOWER(?)`,
            )
            .get(guildId, plexUsername) || null
    );
}

function setLink(guildId, discordUserId, tautulliUserId, plexUsername) {
    db.prepare(
        `
        INSERT INTO plex_links (guildId, discordUserId, tautulliUserId, plexUsername, linkedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guildId, discordUserId) DO UPDATE SET tautulliUserId = excluded.tautulliUserId, plexUsername = excluded.plexUsername, linkedAt = excluded.linkedAt
    `,
    ).run(guildId, discordUserId, String(tautulliUserId), plexUsername || null, Date.now());
    log.info(`Vinculado ${discordUserId} con la cuenta de Plex ${plexUsername || "?"} (Tautulli ${tautulliUserId}) en ${guildId}`);
}

// Re-busca cada vínculo guardado contra la lista actual de usuarios de Tautulli y
// actualiza el tautulliUserId si ha cambiado. Hace falta porque ese ID es interno de
// la instancia de Tautulli: al reinstalarla (p. ej. al mover Plex/Tautulli a otro
// servidor) se reparte desde cero y los vínculos antiguos quedan apuntando a otra
// persona o a nadie, aunque el plexUsername guardado siga siendo correcto.
function relinkAll(guildId, tautulliUsers) {
    const porNombre = new Map();
    for (const u of tautulliUsers || []) {
        if (u.username) porNombre.set(String(u.username).toLowerCase(), u);
        if (u.friendly_name) porNombre.set(String(u.friendly_name).toLowerCase(), u);
    }

    const links = getLinks(guildId);
    const actualizados = [];
    const noEncontrados = [];
    for (const link of links) {
        const match = porNombre.get(String(link.plexUsername || "").toLowerCase());
        if (!match) {
            noEncontrados.push(link.plexUsername || link.tautulliUserId);
            continue;
        }
        if (String(match.user_id) !== String(link.tautulliUserId) || (match.username && match.username !== link.plexUsername)) {
            setLink(guildId, link.discordUserId, match.user_id, match.username || link.plexUsername);
            actualizados.push(link.plexUsername || match.username);
        }
    }
    return { total: links.length, actualizados, noEncontrados };
}

function removeLink(guildId, discordUserId) {
    const r = db.prepare(`DELETE FROM plex_links WHERE guildId = ? AND discordUserId = ?`).run(guildId, discordUserId);
    log.info(`Desvinculado ${discordUserId} de Plex en ${guildId}${r.changes ? "" : " (no tenía vínculo)"}`);
}

module.exports = {
    getLinks,
    getLinkByDiscordId,
    getLinkByPlexUsername,
    setLink,
    relinkAll,
    removeLink,
};
