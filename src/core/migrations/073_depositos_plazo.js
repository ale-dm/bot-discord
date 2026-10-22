// Depósito a plazo (#518): dinero del banco bloqueado a 7, 30 o 90 días. Una persona solo puede tener uno
// activo (índice único parcial); los cerrados se quedan como historial. El interés se calcula al abrirlo y se
// guarda en la fila, para que un cambio de tipos no altere un depósito ya hecho.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS depositos_plazo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            importe INTEGER NOT NULL,
            interes INTEGER NOT NULL,
            dias INTEGER NOT NULL,
            inicio INTEGER NOT NULL,
            vencimiento INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'activo',
            cerrado INTEGER
        )
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_depositos_activo ON depositos_plazo (userId) WHERE estado = 'activo'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_depositos_vencimiento ON depositos_plazo (estado, vencimiento)");
}

module.exports = { up };
