// ⚔️ Retos con una frase de provocación opcional en el mensaje público (#440). Va en el reto y no se pierde cuando cambia
// o se resuelve. Los retos anteriores se quedan sin frase (NULL).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "retos", "provocacion", "TEXT");
}

module.exports = { up };
