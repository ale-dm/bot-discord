// Eventos de mercado de TTCL (F-EC-12d, #120): uno al día, ±5 %, a una hora aleatoria (hora de Madrid). Ver
// systems/cripto/eventos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cripto_eventos (
            dia TEXT PRIMARY KEY,
            minuto INTEGER NOT NULL,
            direccion TEXT NOT NULL,
            porcentaje REAL NOT NULL,
            aplicado_en INTEGER,
            precio_antes REAL,
            precio_despues REAL,
            avisados INTEGER NOT NULL DEFAULT 0
        );
    `);
}

module.exports = { up };
