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
    // Con otra cuenta de Plex, lo que ha visto en ella es una importación nueva (systems/plexImportacion).
    const antes = getLinkByDiscordId(guildId, discordUserId);
    if (antes && antes.tautulliUserId !== String(tautulliUserId)) {
        db.prepare("DELETE FROM plex_importacion WHERE guildId = ? AND userId = ?").run(guildId, discordUserId);
    }
    db.prepare(
        `
        INSERT INTO plex_links (guildId, discordUserId, tautulliUserId, plexUsername, linkedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guildId, discordUserId) DO UPDATE SET tautulliUserId = excluded.tautulliUserId, plexUsername = excluded.plexUsername, linkedAt = excluded.linkedAt
    `,
    ).run(guildId, discordUserId, String(tautulliUserId), plexUsername || null, Date.now());
    log.info(`Vinculado ${discordUserId} con la cuenta de Plex ${plexUsername || "?"} (Tautulli ${tautulliUserId}) en ${guildId}`);
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
    removeLink,
};
