// 🏁 Duelos al mejor de tres (#436): cuántas partidas se juegan en el duelo (1, como siempre, o 3: gana quien llegue antes a
// dos victorias). El marcador de la serie va en `datos`. Los retos anteriores se quedan en 1.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "retos", "serie", "INTEGER NOT NULL DEFAULT 1");
}

module.exports = { up };
