// 🍿 Trofeos de Plex, fases 2 y 3 (systems/plexFichas.js y systems/plexTrofeos.js): las fichas de Tautulli de cada
// película de la biblioteca y de cada serie vista (géneros, directores, colecciones, episodios de cada temporada), los
// trofeos que se van creando (de cada serie, temporada, saga, director, género, década y los que crea un admin) y quién
// prefiere que no se vean los suyos.
const { addColumnIfMissing } = require("./index");

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_fichas (
            guildId TEXT NOT NULL,
            rating_key TEXT NOT NULL,
            tipo TEXT NOT NULL,                     -- movie | show
            titulo TEXT,
            anio INTEGER,
            section_id TEXT,
            biblioteca TEXT,
            generos TEXT NOT NULL DEFAULT '[]',     -- JSON
            directores TEXT NOT NULL DEFAULT '[]',  -- JSON
            colecciones TEXT NOT NULL DEFAULT '[]', -- JSON
            temporadas TEXT,                        -- series: JSON {"1": [1, 2, ...]} (episodios de cada temporada, sin especiales)
            encontrada INTEGER NOT NULL DEFAULT 1,  -- 0: Tautulli ya no la tiene (borrada o vuelta a añadir con otra clave)
            actualizada INTEGER NOT NULL DEFAULT 0, -- ms; 0 = pendiente de pedir la ficha
            PRIMARY KEY (guildId, rating_key)
        );
        CREATE INDEX IF NOT EXISTS idx_plex_fichas_tipo ON plex_fichas(guildId, tipo, actualizada);
        CREATE TABLE IF NOT EXISTS plex_trofeos (
            guildId TEXT NOT NULL,
            id TEXT NOT NULL,                       -- serie:123 · temporada:123:2 · saga:… · director:… · genero:…:10 · decada:1980 · admin:…
            tipo TEXT NOT NULL,                     -- temporada | serie | saga | director | genero | decada | admin
            nombre TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            objetivo INTEGER NOT NULL DEFAULT 1,
            recompensa INTEGER NOT NULL DEFAULT 0,
            anime INTEGER NOT NULL DEFAULT 0,
            condicion TEXT,                         -- solo los de admin ("genero:Terror 20")
            nombre_ia INTEGER NOT NULL DEFAULT 0,   -- 1 si el nombre lo puso Gemini
            creado INTEGER NOT NULL,
            creado_por TEXT,
            PRIMARY KEY (guildId, id)
        );
        CREATE TABLE IF NOT EXISTS plex_preferencias (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            ocultar INTEGER NOT NULL DEFAULT 0,     -- 1: sus logros de Plex no se anuncian ni los ven los demás
            PRIMARY KEY (guildId, userId)
        );
    `);
    // Cuándo se repasó por última vez la lista de películas de la biblioteca (ms).
    addColumnIfMissing(db, "plex_sync", "biblioteca_revisada", "INTEGER");
}

module.exports = { up };
