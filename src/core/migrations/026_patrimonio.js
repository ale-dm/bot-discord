// Patrimonio (F-EC-10, #81): cuándo le tocó a cada persona su último ciclo semanal de intereses e impuesto sobre el
// banco. Ver systems/patrimonio.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS patrimonio_usuario (
            userId TEXT PRIMARY KEY,
            ultimo_ciclo INTEGER NOT NULL
        );
    `);
}

module.exports = { up };
