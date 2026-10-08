// Pase de batalla (#36): progreso de cada persona en cada temporada (xp del pase, topes diarios por categoría, misiones del
// día y recompensas ya cobradas). Las temporadas no se guardan: son bloques de 15 días desde una fecha fija (systems/pase).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS pase_progreso (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            userId TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, temporada, userId)
        );
        CREATE TABLE IF NOT EXISTS pase_caps (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            userId TEXT NOT NULL,
            categoria TEXT NOT NULL,
            dia TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, temporada, userId, categoria, dia)
        );
        CREATE TABLE IF NOT EXISTS pase_misiones (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            mision TEXT NOT NULL,
            progreso INTEGER NOT NULL DEFAULT 0,
            completada INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, temporada, userId, dia, mision)
        );
        CREATE TABLE IF NOT EXISTS pase_recompensas (
            guildId TEXT NOT NULL,
            temporada INTEGER NOT NULL,
            userId TEXT NOT NULL,
            nivel INTEGER NOT NULL,
            cobrado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, temporada, userId, nivel)
        );
    `);
}

module.exports = { up };
