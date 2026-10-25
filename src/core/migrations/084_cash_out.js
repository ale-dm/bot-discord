// 💸 Cash-out anticipado (#529): cuándo se guardaron por última vez las cuotas de cada partido (`cuotas_ts`, ms; una cuota
// vieja no vale para calcular la retirada) y cuándo se retiró una apuesta o una combinada (`retirada_en`, ms). La apuesta
// retirada queda `pagado = 1` con su `premio` (lo cobrado), así la liquidación ya no la toca; la combinada pasa a `retirada`.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "apuestas_partidos", "cuotas_ts", "INTEGER");
    addColumnIfMissing(db, "apuestas_usuario", "retirada_en", "INTEGER");
    addColumnIfMissing(db, "combinadas", "retirada_en", "INTEGER");
}

module.exports = { up };
