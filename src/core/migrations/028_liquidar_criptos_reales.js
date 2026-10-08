// Se quitan BTC, ETH, SOL, BNB, XRP y DOGE (F-EC-12b, #118): lo que tenga cada persona se convierte en monedas al último
// precio que se operó (cripto_historial) y va al efectivo, sin impuesto (es una liquidación, no una venta). Si nunca se
// operó esa cripto, se liquida a 0 y se deja constancia en el log. Las migraciones no dependen del código de mercado.
const CRIPTOS_QUITADAS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];

function up(db, ctx) {
    const log = ctx?.log;
    const ultimoPrecio = db.prepare("SELECT precio FROM cripto_historial WHERE cripto = ? ORDER BY timestamp DESC, id DESC LIMIT 1");
    const tenencias = db.prepare("SELECT userId, cantidad FROM cripto_carteras WHERE cripto = ? AND cantidad > 0");
    const cuenta = db.prepare("INSERT OR IGNORE INTO banco (userId, saldo, enMano) VALUES (?, 0, 0)");
    const pagar = db.prepare("UPDATE banco SET enMano = enMano + ? WHERE userId = ?");
    const apuntar = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, 'cripto')");
    const ahora = new Date().toISOString();

    for (const sym of CRIPTOS_QUITADAS) {
        const precio = ultimoPrecio.get(sym)?.precio || 0;
        if (!precio) log?.warn(`${sym} nunca tuvo un precio operado: se liquida a 0`);
        for (const { userId, cantidad } of tenencias.all(sym)) {
            const monedas = Math.floor(cantidad * precio);
            if (monedas > 0) {
                cuenta.run(userId);
                pagar.run(monedas, userId);
                apuntar.run(userId, ahora, `Liquidación de ${sym} (cripto retirada)`, monedas);
            }
        }
    }
    db.prepare(`DELETE FROM cripto_carteras WHERE cripto IN (${CRIPTOS_QUITADAS.map(() => "?").join(", ")})`).run(...CRIPTOS_QUITADAS);
}

module.exports = { up };
