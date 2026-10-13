// 📊 Encuestas rápidas (#426): la encuesta (pregunta, opciones, dónde está su mensaje y cuándo se cierra) y un voto por persona
// (cambiar el voto reemplaza el anterior). Ver systems/encuestas.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS encuestas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            channelId TEXT,
            messageId TEXT,
            creador TEXT NOT NULL,
            pregunta TEXT NOT NULL,
            opciones TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'abierta',
            creada_en INTEGER NOT NULL,
            cierra_en INTEGER NOT NULL,
            cerrada_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_encuestas_estado ON encuestas(estado, cierra_en);
        CREATE TABLE IF NOT EXISTS encuesta_votos (
            encuesta_id INTEGER NOT NULL,
            userId TEXT NOT NULL,
            opcion INTEGER NOT NULL,
            votado_en INTEGER NOT NULL,
            PRIMARY KEY (encuesta_id, userId)
        );
    `);
}

module.exports = { up };
