// Motor de impuestos (F-EC-06a): reglas configurables por servidor, no un % fijo en el código.
// Ver systems/impuestos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS impuestos_reglas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            base TEXT NOT NULL,
            tipoMovimiento TEXT,
            porcentaje REAL NOT NULL,
            activo INTEGER NOT NULL DEFAULT 1,
            destino TEXT NOT NULL DEFAULT 'bote',
            creadoEn INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_impuestos_reglas_guild ON impuestos_reglas (guildId);

        CREATE TABLE IF NOT EXISTS impuestos_bote (
            guildId TEXT PRIMARY KEY,
            total REAL NOT NULL DEFAULT 0
        );
    `);
}

module.exports = { up };
