// Sesión de cine (#24): una convocatoria `/cine` con botones para apuntarse. cine_sesiones guarda la sesión (y si ya se
// mandó el recordatorio de 10 minutos antes); cine_asistentes, quién se ha apuntado. Ver systems/cine.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cine_sesiones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            canalId TEXT NOT NULL,
            mensajeId TEXT,
            organizador TEXT NOT NULL,
            peli TEXT NOT NULL,
            inicio TEXT NOT NULL,
            recordatorio INTEGER NOT NULL DEFAULT 0,
            cancelada INTEGER NOT NULL DEFAULT 0,
            creada_en TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cine_asistentes (
            sesion_id INTEGER NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (sesion_id, userId),
            FOREIGN KEY(sesion_id) REFERENCES cine_sesiones(id)
        );
    `);
}

module.exports = { up };
