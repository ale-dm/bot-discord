// 🛡️ Límite de pérdidas personal (#319): lo que cada persona se pone a sí misma en el casino y las apuestas (en monedas, por día o por
// semana). Bajarlo vale al momento; subirlo o quitarlo queda como cambio pendiente (`pend_*`) y se aplica pasadas 24 h
// (`pend_aplica_en`, en ms; `pend_limite` 0 = quitarlo). Ver systems/limitePerdidas.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS limite_perdidas (
            userId TEXT PRIMARY KEY,
            limite INTEGER NOT NULL,
            periodo TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            pend_limite INTEGER,
            pend_periodo TEXT,
            pend_aplica_en INTEGER
        );
    `);
}

module.exports = { up };
