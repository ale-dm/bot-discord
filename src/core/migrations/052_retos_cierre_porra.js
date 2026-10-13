// 🗳️ Cierre automático de porras (#448): hasta cuándo (ms) se admiten entradas. NULL = la porra se cierra a mano, como
// siempre. Al llegar la fecha, el cron la pasa a «cerrada». Ver systems/retos/revision.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "retos", "cierra_en", "INTEGER");
}

module.exports = { up };
