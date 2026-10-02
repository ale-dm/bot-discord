// 🍿 Logros de Plex: copia local del historial de Tautulli (lo que ha visto cada uno) para calcular los logros sin
// preguntar a Tautulli cada vez (systems/plexHistorial.js).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_reproducciones (
            guildId TEXT NOT NULL,
            id INTEGER NOT NULL,            -- id de la fila en el historial de Tautulli
            tautulliUserId TEXT NOT NULL,
            tipo TEXT NOT NULL,             -- movie | episode
            rating_key TEXT,                -- la película o el episodio
            serie_key TEXT,                 -- la serie (grandparent_rating_key)
            titulo TEXT,
            serie TEXT,
            temporada INTEGER,
            episodio INTEGER,
            anio INTEGER,
            inicio INTEGER NOT NULL,        -- unix, en segundos
            segundos INTEGER NOT NULL,      -- tiempo visto, sin pausas
            porcentaje INTEGER,
            visto INTEGER NOT NULL DEFAULT 0, -- Tautulli lo da por visto (según su % configurado)
            PRIMARY KEY (guildId, id)
        );
        CREATE INDEX IF NOT EXISTS idx_plex_reproducciones_usuario ON plex_reproducciones(guildId, tautulliUserId);
        CREATE TABLE IF NOT EXISTS plex_sync (
            guildId TEXT PRIMARY KEY,
            ultimo_inicio INTEGER NOT NULL DEFAULT 0, -- la reproducción más reciente copiada (unix, segundos)
            ultima_sync INTEGER                       -- ms
        );
    `);
}

module.exports = { up };
