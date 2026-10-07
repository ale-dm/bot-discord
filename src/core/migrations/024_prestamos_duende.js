// 🧙 Préstamos del Duende (F-DU-03, #14): uno por persona a la vez, con lo que hay que devolver y lo ya pagado. Al
// vencer se cobra solo; lo que no llega queda como deuda (estado 'deuda'). Ver systems/prestamos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS prestamos_duende (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            guildId TEXT,
            cantidad INTEGER NOT NULL,
            total INTEGER NOT NULL,
            pagado INTEGER NOT NULL DEFAULT 0,
            estado TEXT NOT NULL DEFAULT 'activo',
            creado_en INTEGER NOT NULL,
            vence_en INTEGER NOT NULL,
            cerrado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_prestamos_duende_user ON prestamos_duende (userId, estado);
        CREATE INDEX IF NOT EXISTS idx_prestamos_duende_vence ON prestamos_duende (estado, vence_en);
    `);
}

module.exports = { up };
