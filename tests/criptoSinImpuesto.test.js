// Ventas de cripto sin impuesto de ingreso (F-EC-06a/#119): aunque haya una regla general del 5 %, lo que entra por
// vender TTCL es íntegro. Sí se cobra la deuda con el Duende, como cualquier ingreso.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/cripto/mercado");
const impuestos = require("../src/systems/impuestos");

const G = "guild-cripto-sin-impuesto";
let n = 0;
function vendedor(ttcl) {
    const id = `sinimp-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', ?)").run(id, ttcl);
    return id;
}

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
});

test("con una regla general del 5 % de ingresos, vender TTCL recibe el neto íntegro y no hay línea de impuesto", async () => {
    impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 5, destino: "bote" });
    const u = vendedor(100);
    const antes = dinero.efectivo(u);

    const r = await mercado.ejecutarVenta(G, u, "TTCL", 100);

    expect(r.ok).toBe(true);
    expect(dinero.efectivo(u)).toBe(antes + r.monedas);
    expect(db.prepare("SELECT 1 FROM historial WHERE userId = ? AND tipo = 'impuesto'").get(u)).toBeUndefined();
    expect(impuestos.boteTotal(G)).toBe(0);
});

test("la venta de cripto cobra la deuda con el Duende, como cualquier ingreso", async () => {
    const u = vendedor(100);
    db.prepare(
        "INSERT INTO prestamos_duende (userId, guildId, cantidad, total, pagado, creado_en, vence_en, estado) VALUES (?, ?, 500, 550, 0, 0, 0, 'deuda')",
    ).run(u, G);
    const antes = dinero.efectivo(u);

    const r = await mercado.ejecutarVenta(G, u, "TTCL", 100);

    // De lo que entra se descuenta la deuda; el resto va al efectivo.
    expect(dinero.efectivo(u)).toBe(antes + r.monedas - 550);
    expect(db.prepare("SELECT estado FROM prestamos_duende WHERE userId = ?").get(u).estado).toBe("devuelto");
});
