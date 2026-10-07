// /robar (F-EC-06b): columna de dinero negro aparte del efectivo normal, y cooldown global
// (no por servidor, a diferencia de /trabajar) de quien roba. Ver systems/robar.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "banco", "negro", "INTEGER NOT NULL DEFAULT 0");

    db.exec(`
        CREATE TABLE IF NOT EXISTS robos_cooldown (
            userId TEXT PRIMARY KEY,
            lastTs INTEGER NOT NULL
        );
    `);
}

module.exports = { up };
