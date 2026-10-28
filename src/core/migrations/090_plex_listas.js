// 📚 Listas de películas y series de Plex (#575, épica #536): cada persona crea listas ordenadas («Top 10 de Nolan»,
// «Para Halloween»), públicas o privadas, con títulos que existen en Plex. Cada título guarda la misma clave que las
// reseñas (`peli:…` o `serie:…`) para abrir su ficha. Ver systems/plexListas.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_listas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            publica INTEGER NOT NULL DEFAULT 1,
            creada_en INTEGER NOT NULL,
            actualizada_en INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plex_listas_usuario ON plex_listas(guildId, userId);
        CREATE INDEX IF NOT EXISTS idx_plex_listas_publicas ON plex_listas(guildId, publica, actualizada_en);
        CREATE TABLE IF NOT EXISTS plex_lista_items (
            lista_id INTEGER NOT NULL REFERENCES plex_listas(id) ON DELETE CASCADE,
            posicion INTEGER NOT NULL,
            clave TEXT NOT NULL,
            tipo TEXT NOT NULL,
            titulo TEXT NOT NULL,
            anio INTEGER,
            anadido_en INTEGER NOT NULL,
            PRIMARY KEY (lista_id, clave)
        );
        CREATE INDEX IF NOT EXISTS idx_plex_lista_items_orden ON plex_lista_items(lista_id, posicion);
    `);
}

module.exports = { up };
