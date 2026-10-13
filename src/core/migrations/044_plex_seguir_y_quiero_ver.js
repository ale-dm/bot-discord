// Avisos personales de Plex por DM:
//   - plex_series_seguidas (#465): las series que sigue cada uno (por la rating_key de la serie en Plex). Se avisa de
//     lo que entre en Plex después de `creado_en` (unix, s), así que seguir una serie no avisa de lo que ya estaba.
//   - plex_avisos_series: lo ya avisado (persona + rating_key de lo nuevo en Plex), para no avisar dos veces.
//   - plex_quiero_ver (#466): la lista de «quiero ver» de cada uno, por id de TMDB (el mismo que usa Seerr).
//     `disponible_en` (unix, s) se rellena cuando llega a Plex y se avisa una sola vez.
// Ver systems/plexAvisos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_series_seguidas (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            serie_key TEXT NOT NULL,
            titulo TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, serie_key)
        );
        CREATE INDEX IF NOT EXISTS idx_plex_series_seguidas_serie ON plex_series_seguidas (guildId, serie_key);
        CREATE TABLE IF NOT EXISTS plex_avisos_series (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            rating_key TEXT NOT NULL,
            avisado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, userId, rating_key)
        );
        CREATE TABLE IF NOT EXISTS plex_quiero_ver (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            media_type TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL,
            titulo TEXT NOT NULL,
            anio TEXT,
            creado_en INTEGER NOT NULL,
            disponible_en INTEGER,
            PRIMARY KEY (guildId, userId, media_type, tmdb_id)
        );
        CREATE INDEX IF NOT EXISTS idx_plex_quiero_ver_pendientes ON plex_quiero_ver (guildId, disponible_en);
    `);
}

module.exports = { up };
