// TTCL como pool de liquidez (F-EC-12a, #117): el precio sale de las reservas de monedas y de TTCL (x·y = k), no de
// la circulación. El precio vuelve a 100 con 1.000.000 monedas y 10.000 TTCL. Las unidades que ya tiene cada persona
// se conservan (cripto_carteras). Ver systems/cripto/mercado.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cripto_pool (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            monedas REAL NOT NULL,
            ttcl REAL NOT NULL
        );
    `);
    db.prepare("INSERT OR REPLACE INTO cripto_pool (id, monedas, ttcl) VALUES (1, 1000000, 10000)").run();
    // Un punto en el precio de partida, para que el gráfico tenga el reinicio.
    db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (100, ?)").run(Date.now());
    db.exec("DROP TABLE IF EXISTS cripto_ttcl");
}

module.exports = { up };
