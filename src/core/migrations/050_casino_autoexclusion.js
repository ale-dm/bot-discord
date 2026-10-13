// 🔒 Autoexclusión del casino (#463): una fila por persona con el momento (ms) en que acaba. Mientras `hasta` sea futuro,
// ningún juego del casino cobra apuestas. Global, como el dinero. Cuando pasa, la fila se queda y simplemente deja de
// valer: no hace falta ninguna acción para que el casino vuelva. Ver systems/casinoAutoexclusion.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS casino_autoexclusion (
            userId TEXT PRIMARY KEY,
            hasta INTEGER NOT NULL,
            desde INTEGER NOT NULL
        );
    `);
}

module.exports = { up };
