// 🧾 Historial de /cripto con la comisión de cada operación (#441). Las operaciones anteriores se quedan con la comisión
// en NULL (no se reconstruye del texto del apunte de dinero): el historial las enseña con «—», no con un 0 que parezca real.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "cripto_historial", "comision", "INTEGER");
}

module.exports = { up };
