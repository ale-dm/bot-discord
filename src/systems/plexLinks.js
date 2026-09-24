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

function removeLink(guildId, discordUserId) {
    const r = db.prepare(`DELETE FROM plex_links WHERE guildId = ? AND discordUserId = ?`).run(guildId, discordUserId);
    log.info(`Desvinculado ${discordUserId} de Plex en ${guildId}${r.changes ? "" : " (no tenía vínculo)"}`);
}

module.exports = {
    getLinks,
    getLinkByDiscordId,
    setLink,
    removeLink,
};
