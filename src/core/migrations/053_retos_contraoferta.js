// 💬 Contraoferta de cantidad en un reto (#442): la cantidad que propone el rival en vez de aceptar o rechazar. NULL = sin
// contraoferta. Solo se permite una por reto. Ver systems/retos/contraoferta.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "retos", "contraoferta", "INTEGER");
}

module.exports = { up };
