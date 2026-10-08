// Migración 028 (F-EC-12b, #118): BTC, ETH, SOL, BNB, XRP y DOGE se liquidan al último precio operado, sin impuesto,
// y lo que no tiene precio conocido se liquida a 0. TTCL no se toca.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { up } = require("../src/core/migrations/028_liquidar_criptos_reales");

const log = { warn: jest.fn() };

test("las criptos retiradas se pagan al último precio operado, sin impuesto, y se borran de la cartera", () => {
    const u = "liq-1";
    dinero.asegurarCuenta(u);
    const antes = dinero.efectivo(u);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'BTC', 2), (?, 'TTCL', 3)").run(u, u);
    db.prepare(
        "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES ('otro','compra','BTC',1,40000,40000,1000), ('otro','venta','BTC',1,50000,50000,2000)",
    ).run();

    up(db, { log });

    expect(dinero.efectivo(u)).toBe(antes + 2 * 50000); // último precio: 50.000, sin impuesto
    expect(db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'BTC'").get(u)).toBeUndefined();
    expect(db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(u).cantidad).toBe(3);
    expect(db.prepare("SELECT cantidad, tipo FROM historial WHERE userId = ? AND tipo = 'cripto'").get(u)).toEqual({
        cantidad: 100000,
        tipo: "cripto",
    });
});

test("una cripto sin precio operado se liquida a 0 y deja constancia en el log", () => {
    const u = "liq-2";
    dinero.asegurarCuenta(u);
    const antes = dinero.efectivo(u);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'DOGE', 7)").run(u);
    log.warn.mockClear();

    up(db, { log });

    expect(dinero.efectivo(u)).toBe(antes);
    expect(db.prepare("SELECT 1 FROM cripto_carteras WHERE userId = ? AND cripto = 'DOGE'").get(u)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/DOGE nunca tuvo un precio/));
});
