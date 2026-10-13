// 🔔 Preferencias de avisos por DM (#431): un interruptor por persona y tipo de aviso, global (como el dinero, no por
// servidor). Sin fila = encendido; la fila `no_molestar` activa apaga todos los avisos. Ver systems/avisosDm.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS preferencias_dm (
            userId TEXT NOT NULL,
            tipo TEXT NOT NULL,
            activo INTEGER NOT NULL,
            PRIMARY KEY (userId, tipo)
        );
    `);
}

module.exports = { up };
