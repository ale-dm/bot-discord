// 📋 Encargos semanales de economía (#523): los tres retos de cada persona y semana (lunes de Madrid), con su categoría,
// dificultad, meta, recompensa, progreso y cuándo se completó y se cobró. Ver systems/encargos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS encargos (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            semana TEXT NOT NULL,
            slot INTEGER NOT NULL,
            encargo TEXT NOT NULL,
            categoria TEXT NOT NULL,
            dificultad TEXT NOT NULL,
            meta INTEGER NOT NULL,
            recompensa INTEGER NOT NULL,
            progreso INTEGER NOT NULL DEFAULT 0,
            completado_en INTEGER,
            reclamado_en INTEGER,
            PRIMARY KEY (guildId, userId, semana, slot)
        );
        CREATE INDEX IF NOT EXISTS idx_encargos_categoria ON encargos(guildId, userId, semana, categoria);
    `);
}

module.exports = { up };
