// 🤝 Préstamos entre jugadores (#520): el contrato (quién presta y a quién, cuánto, el interés, el plazo, lo pagado y su
// estado: propuesto, activo, deuda, devuelto, rechazado, cancelado o caducado) y si ya se avisó del vencimiento. Ver
// systems/prestamosJugadores.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS prestamos_jugadores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            prestamista TEXT NOT NULL,
            prestatario TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            interes_pct INTEGER NOT NULL,
            total INTEGER NOT NULL,
            pagado INTEGER NOT NULL DEFAULT 0,
            plazo_dias INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'propuesto',
            creado_en INTEGER NOT NULL,
            aceptado_en INTEGER,
            vence_en INTEGER,
            cerrado_en INTEGER,
            avisado INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_prestamos_jugadores_estado ON prestamos_jugadores(estado, vence_en);
        CREATE INDEX IF NOT EXISTS idx_prestamos_jugadores_prestamista ON prestamos_jugadores(prestamista, estado);
        CREATE INDEX IF NOT EXISTS idx_prestamos_jugadores_prestatario ON prestamos_jugadores(prestatario, estado);
    `);
}

module.exports = { up };
