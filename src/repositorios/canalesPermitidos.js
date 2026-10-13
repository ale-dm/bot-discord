// SQL de los canales donde se pueden usar Plex y Seerr (lista vacía = sin restricción; con algún canal, solo esos). Las usan los
// clientes de Tautulli y Seerr sin tocar la base de datos ellos mismos (#478).
const db = require("../core/db");

const TABLAS = { plex: "plex_allowed_channels", seerr: "seerr_allowed_channels" };

/** Las operaciones sobre la lista de canales permitidos de un servicio (`plex` o `seerr`). */
function canalesPermitidos(servicio) {
    const tabla = TABLAS[servicio];
    if (!tabla) throw new Error(`Servicio desconocido: ${servicio}`);
    return {
        todos: (guildId) =>
            db.prepare(`SELECT channelId, channelName FROM ${tabla} WHERE guildId = ? ORDER BY channelName ASC`).all(guildId),
        agregar: (guildId, channelId, channelName) =>
            db
                .prepare(
                    `INSERT INTO ${tabla} (guildId, channelId, channelName) VALUES (?, ?, ?)
                     ON CONFLICT(guildId, channelId) DO UPDATE SET channelName = excluded.channelName`,
                )
                .run(guildId, channelId, channelName || null),
        quitar: (guildId, channelId) => db.prepare(`DELETE FROM ${tabla} WHERE guildId = ? AND channelId = ?`).run(guildId, channelId),
        vaciar: (guildId) => db.prepare(`DELETE FROM ${tabla} WHERE guildId = ?`).run(guildId),
    };
}

module.exports = { canalesPermitidos };
