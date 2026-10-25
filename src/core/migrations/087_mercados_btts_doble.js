// Mercados «ambos marcan» y «doble oportunidad» (#532). El partido guarda las cuotas que da la Odds API (mercados
// adicionales `btts` y `double_chance`, que se piden partido a partido) y cuándo se pidieron (`extras_ts`, en ms) para
// no gastar créditos repitiendo la consulta. Ninguno de los dos tiene línea. Ver systems/apuestas/mercados.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    for (const columna of ["cuota_ambos_si", "cuota_ambos_no", "cuota_dc_1x", "cuota_dc_12", "cuota_dc_x2"]) {
        addColumnIfMissing(db, "apuestas_partidos", columna, "REAL");
    }
    addColumnIfMissing(db, "apuestas_partidos", "extras_ts", "INTEGER");
}

module.exports = { up };
