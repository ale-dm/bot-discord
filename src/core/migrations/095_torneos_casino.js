// 🏆 Torneos de casino (#525): el torneo que programa un admin (juego, inscripción, cuándo empieza y acaba, dónde está su
// mensaje y su bote) y quién se ha inscrito, con su resultado neto, su puesto y su premio al cerrar. Ver systems/torneos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS torneos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            juego TEXT NOT NULL,
            inscripcion INTEGER NOT NULL,
            empieza INTEGER NOT NULL,
            termina INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'inscripcion',
            bote INTEGER NOT NULL DEFAULT 0,
            creado_por TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            channelId TEXT,
            messageId TEXT,
            cerrado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_torneos_estado ON torneos(estado, empieza, termina);
        CREATE INDEX IF NOT EXISTS idx_torneos_guild ON torneos(guildId, estado);
        CREATE TABLE IF NOT EXISTS torneo_inscritos (
            torneo_id INTEGER NOT NULL REFERENCES torneos(id),
            userId TEXT NOT NULL,
            inscrito_en INTEGER NOT NULL,
            neto INTEGER,
            puesto INTEGER,
            premio INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (torneo_id, userId)
        );
    `);
}

module.exports = { up };
