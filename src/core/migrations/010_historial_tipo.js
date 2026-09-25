// Tipo de cada movimiento del historial (casino, apuestas, tienda, cripto, banco, transferencia, logro,
// objeto, admin u otro), para poder filtrar los movimientos. Los nuevos lo apuntan al escribirse
// (systems/dinero.apuntar); los que ya había se clasifican por su descripción.
const { addColumnIfMissing } = require("./index");

// El orden importa: el primer patrón que encaja gana ("Reembolso: partida de…" es del casino; el resto de
// reembolsos, de apuestas; "Compra en tienda:" antes que las compras de cripto).
const REGLAS = [
    ["casino", ["🎰%", "Ruleta%", "Blackjack%", "Adivinar%", "PPT:%", "Reembolso: partida de %"]],
    ["apuestas", ["Apuesta%", "Quiniela%", "Reembolso:%"]],
    ["tienda", ["Compra en tienda:%"]],
    ["cripto", ["Compra %", "Venta %"]],
    ["banco", ["Depósito", "Retirada", "Ingreso en el banco", "Retirada del banco"]],
    ["transferencia", ["Transferencia%"]],
    ["logro", ["Recompensa logro%"]],
    ["objeto", ["Efecto consumible%"]],
    ["admin", ["Modificación admin%", "Reseteo admin%"]],
];

function up(db, { log } = {}) {
    addColumnIfMissing(db, "historial", "tipo", "TEXT");
    const clasificar = db.prepare("UPDATE historial SET tipo = ? WHERE tipo IS NULL AND descripcion LIKE ?");
    let n = 0;
    for (const [tipo, patrones] of REGLAS) {
        for (const p of patrones) n += clasificar.run(tipo, p).changes;
    }
    n += db.prepare("UPDATE historial SET tipo = 'otro' WHERE tipo IS NULL").run().changes;
    db.exec("CREATE INDEX IF NOT EXISTS idx_historial_usuario_tipo ON historial (userId, tipo, fecha)");
    if (n) log?.info(`Clasificados ${n} movimientos del historial por tipo`);
}

module.exports = { up };
