// ⚔️ Recordatorio de un reto pendiente (#439): cuándo se le avisó al rival de que el reto caduca, para no repetirlo. NULL
// = aún no se ha avisado. Ver systems/retos/revision.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "retos", "recordado_en", "INTEGER");
}

module.exports = { up };
