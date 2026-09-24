// Al liquidar se marcaba pagado = 1 tanto a las apuestas ganadoras como a las perdidas, así
// que /misapuestas mostraba todas como "Ganada" y las estadísticas nunca contaban pérdidas.
// Ahora se guarda el resultado del partido y el premio de cada apuesta (0 = perdida).
// Las apuestas liquidadas antes de esto quedan con premio NULL ("liquidada", sin saber cuál).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "apuestas_partidos", "resultado", "TEXT");
    addColumnIfMissing(db, "apuestas_usuario", "premio", "INTEGER");
}

module.exports = { up };
