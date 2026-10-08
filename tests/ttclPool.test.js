// TTCL como pool de liquidez (F-EC-12a, #117): el precio sale de las reservas, cada operación se cobra contra el pool,
// la comisión queda en el pool, y el ciclo compra→venta ya no deja beneficio.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/cripto/mercado");

const G = "guild-ttcl-pool";
let n = 0;
function cliente(efectivo) {
    const id = `pool-${++n}`;
    dinero.pagar(id, efectivo);
    return id;
}
const pool = () => db.prepare("SELECT monedas, ttcl FROM cripto_pool WHERE id = 1").get();

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
});

test("el precio arranca en 100 con el pool de 1.000.000 monedas y 10.000 TTCL", () => {
    expect(mercado.getTtclPrecio()).toBe(100);
});

test("una compra de 500.000 monedas recibe TTCL según las reservas, y la comisión se queda en el pool", async () => {
    const u = cliente(1_000_000);
    const r = await mercado.ejecutarCompra(G, u, "TTCL", 500000);
    // 10.000 − (1.000.000 × 10.000) / (1.000.000 + 500.000) = 3.333,33 TTCL. Coste: 500.000 + comisión 1 %.
    expect(r.ok).toBe(true);
    expect(r.cantidad).toBeCloseTo(10000 - 1e10 / 1.5e6, 6);
    expect(r.fee).toBe(5000);
    expect(dinero.efectivo(u)).toBe(dinero.INICIAL + 1_000_000 - 505_000);
    expect(pool().monedas).toBe(1_000_000 + 505_000);
    expect(pool().ttcl).toBeCloseTo(10000 - r.cantidad, 6);
});

test("una compra grande sube el precio más que una pequeña", async () => {
    const pequena = cliente(1_000_000);
    await mercado.ejecutarCompra(G, pequena, "TTCL", 1000);
    const precioPequena = mercado.getTtclPrecio();
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    const grande = cliente(1_000_000);
    await mercado.ejecutarCompra(G, grande, "TTCL", 500000);
    expect(mercado.getTtclPrecio()).toBeGreaterThan(precioPequena);
    expect(mercado.getTtclPrecio()).toBeGreaterThan(100);
});

test("el ciclo comprar y vender de vuelta ya no da beneficio (antes sí, con la venta a precio posterior a la compra)", async () => {
    const u = cliente(3_000_000);
    const antes = dinero.efectivo(u);
    const compra = await mercado.ejecutarCompra(G, u, "TTCL", 500000);
    expect(compra.ok).toBe(true);

    // Se vende todo lo que tiene, en trozos que respeten el máximo por venta. Se suman las monedas netas que
    // devuelve el pool (antes de impuestos) para comparar con lo que costó.
    let recibido = 0;
    for (let k = 0; k < 20; k++) {
        const tenencia = db
            .prepare("SELECT COALESCE(SUM(cantidad), 0) AS n FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'")
            .get(u).n;
        if (tenencia < 1e-6) break;
        const precio = mercado.getTtclPrecio();
        const pct = Math.min(100, Math.max(1, Math.floor((480000 / precio / tenencia) * 100)));
        const r = await mercado.ejecutarVenta(G, u, "TTCL", pct);
        expect(r.ok).toBe(true);
        recibido += r.monedas;
    }
    expect(recibido).toBeLessThan(500000);
    expect(dinero.efectivo(u)).toBeLessThan(antes);
});

test("la comisión de la venta también se queda en el pool", async () => {
    const u = cliente(0);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 100)").run(u);
    const antes = pool();
    const r = await mercado.ejecutarVenta(G, u, "TTCL", 100);
    expect(r.ok).toBe(true);
    // El pool entrega el neto (lo recibido) y recibe el TTCL; la comisión no sale del pool.
    expect(pool().monedas).toBeCloseTo(antes.monedas - r.monedas, 6);
    expect(pool().ttcl).toBeCloseTo(antes.ttcl + 100, 6);
});

test("una venta fuera de los límites se rechaza sin tocar la cartera ni el pool", async () => {
    const u = cliente(0);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 0.5)").run(u);
    const antes = pool();
    const r = await mercado.ejecutarVenta(G, u, "TTCL", 100);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/La venta debe estar entre/);
    expect(pool()).toEqual(antes);
    expect(db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(u).cantidad).toBe(0.5);
});

test("una compra fuera de los límites se rechaza", async () => {
    const u = cliente(10_000_000);
    const r = await mercado.ejecutarCompra(G, u, "TTCL", 50);
    expect(r.ok).toBe(false);
    expect(pool().monedas).toBe(1_000_000);
});

test("la circulación es lo que tiene la gente, no lo que hay en el pool", async () => {
    const u = cliente(1_000_000);
    await mercado.ejecutarCompra(G, u, "TTCL", 100000);
    expect(mercado.ttclCirculacion()).toBeCloseTo(
        db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(u).cantidad,
        6,
    );
});
