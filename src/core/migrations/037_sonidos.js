// Panel de sonidos (/sonidos, #sonidos): los sonidos de cada servidor. El fichero va en DATA_DIR/sonidos/<servidor>/<id>.<ext>;
// aquí queda su nombre (único por servidor, sin distinguir mayúsculas) y quién lo subió. Ver systems/sonidos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sonidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            nombre TEXT NOT NULL COLLATE NOCASE,
            archivo TEXT NOT NULL,
            creado_por TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            UNIQUE (guildId, nombre)
        );
    `);
}

module.exports = { up };
