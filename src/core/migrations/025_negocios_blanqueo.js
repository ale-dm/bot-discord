// Negocios y blanqueo (F-EC-06d, #80): negocios comprados con el banco que limpian el dinero negro
// en 24 h y dan un ingreso diario. Ver systems/negocios.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS negocios_usuario (
            userId TEXT NOT NULL,
            tipo TEXT NOT NULL,
            guildId TEXT,
            pagado INTEGER NOT NULL,
            comprado_en INTEGER NOT NULL,
            ultimo_ingreso_dia TEXT,
            PRIMARY KEY (userId, tipo)
        );

        CREATE TABLE IF NOT EXISTS blanqueo_lotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            guildId TEXT,
            cantidad INTEGER NOT NULL,
            liberado INTEGER NOT NULL DEFAULT 0,
            inicio INTEGER NOT NULL,
            fin INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_blanqueo_lotes_user ON blanqueo_lotes (userId);

        CREATE TABLE IF NOT EXISTS blanqueo_dia (
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            depositado INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (userId, dia)
        );
    `);
}

module.exports = { up };
