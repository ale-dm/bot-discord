// Resumen por apostador para el ranking (#285): beneficio, apuestas resueltas, ganadas y perdidas de cada uno. Lo
// reconstruye systems/apuestas/ranking.reconstruirResumen al final de cada liquidación (orquesta.js), que es lo único
// que cambia lo resuelto. Así leer el ranking no recorre todas las apuestas.
function up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS apuestas_resumen (
        user_id TEXT PRIMARY KEY,
        beneficio INTEGER NOT NULL,
        resueltas INTEGER NOT NULL,
        ganadas INTEGER NOT NULL,
        perdidas INTEGER NOT NULL
    )`);
}

module.exports = { up };
