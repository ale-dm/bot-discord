// Mercados de goles (#9, más/menos 2,5) y de hándicap (#10, ±1,5) de las apuestas deportivas. El partido guarda la línea y
// las cuotas que da la Odds API; cada apuesta guarda la línea con la que se apostó (apuestas_usuario.linea), así que un
// cambio posterior de línea no altera cómo se liquida. Ver systems/apuestas/mercados.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    for (const [columna, definicion] of [
        ["cuota_mas", "REAL"],
        ["cuota_menos", "REAL"],
        ["total_linea", "REAL"],
        ["cuota_casa", "REAL"],
        ["cuota_fuera", "REAL"],
        ["hcap_linea", "REAL"],
    ]) {
        addColumnIfMissing(db, "apuestas_partidos", columna, definicion);
    }
    addColumnIfMissing(db, "apuestas_usuario", "linea", "REAL");
}

module.exports = { up };
