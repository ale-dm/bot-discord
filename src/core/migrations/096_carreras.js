// 🏇 Carreras con cuotas (#535): cada carrera (sus corredores con su peso y su cuota, cuándo se corre, dónde está su mensaje y
// quién ganó) y una apuesta por persona y carrera a un corredor, con su cuota y su premio. Ver systems/carreras.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS carreras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            channelId TEXT,
            messageId TEXT,
            estado TEXT NOT NULL DEFAULT 'abierta',
            corredores TEXT NOT NULL,
            empieza INTEGER NOT NULL,
            avisada INTEGER NOT NULL DEFAULT 0,
            ganador INTEGER,
            resuelta_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_carreras_estado ON carreras(estado, empieza);
        CREATE INDEX IF NOT EXISTS idx_carreras_guild ON carreras(guildId, estado);
        CREATE TABLE IF NOT EXISTS carrera_apuestas (
            carrera_id INTEGER NOT NULL REFERENCES carreras(id),
            userId TEXT NOT NULL,
            corredor INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            cuota REAL NOT NULL,
            premio INTEGER NOT NULL DEFAULT 0,
            creada INTEGER NOT NULL,
            PRIMARY KEY (carrera_id, userId)
        );
    `);
}

module.exports = { up };
