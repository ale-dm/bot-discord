// SQL del canal de novedades de Plex: hasta qué momento ya se han anunciado las novedades de cada servidor (#478).
const db = require("../core/db");

const ultimaNovedad = (guildId) => {
    const row = db.prepare("SELECT lastAddedAt FROM plex_novedades_state WHERE guildId = ?").get(guildId);
    return row ? Number(row.lastAddedAt) : 0;
};

const guardarUltimaNovedad = (guildId, ts) =>
    db
        .prepare(
            `INSERT INTO plex_novedades_state (guildId, lastAddedAt) VALUES (?, ?)
             ON CONFLICT(guildId) DO UPDATE SET lastAddedAt = excluded.lastAddedAt`,
        )
        .run(guildId, ts);

module.exports = { ultimaNovedad, guardarUltimaNovedad };
