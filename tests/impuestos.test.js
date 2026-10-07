// Motor de impuestos (F-EC-06a): reglas configurables por servidor, la regla por defecto, que la
// específica gana a la general, exclusiones fijas, y el bote.
const db = require("../src/core/db");
const impuestos = require("../src/systems/impuestos");

const G = "guild-impuestos";

beforeEach(() => {
    db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
});

test("sin ninguna regla, al primer cálculo se siembra la de por defecto (5% sobre ingresos, al bote)", () => {
    expect(impuestos.listarReglas(G)).toEqual([]);
    const r = impuestos.calcularImpuesto(G, "trabajo", 100);
    expect(r).toEqual({ impuesto: 5, destino: "bote", reglaId: expect.any(Number) });
    expect(impuestos.listarReglas(G)).toMatchObject([{ base: "ingreso", tipoMovimiento: null, porcentaje: 5, activo: true }]);
});

test("no cobra nada a los tipos siempre excluidos (transferencia, banco, admin)", () => {
    for (const tipo of impuestos.TIPOS_EXCLUIDOS) {
        expect(impuestos.calcularImpuesto(G, tipo, 1000)).toBeNull();
    }
});

test("sin guildId, no revienta: simplemente no aplica ningún impuesto", () => {
    expect(impuestos.calcularImpuesto(null, "trabajo", 1000)).toBeNull();
    expect(impuestos.impuestoDeCompra(null, 1000)).toBeNull();
});

test("redondea siempre hacia abajo", () => {
    impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 5 });
    expect(impuestos.calcularImpuesto(G, "trabajo", 19)).toBeNull(); // floor(19*0.05) = 0
    expect(impuestos.calcularImpuesto(G, "trabajo", 39).impuesto).toBe(1); // floor(39*0.05) = 1
});

test("una regla específica para un tipo gana a la general, no se suman", () => {
    impuestos.anadirRegla(G, { base: "ingreso", tipoMovimiento: null, porcentaje: 5, destino: "bote" });
    impuestos.anadirRegla(G, { base: "ingreso", tipoMovimiento: "casino", porcentaje: 20, destino: "sumidero" });

    expect(impuestos.calcularImpuesto(G, "casino", 100)).toEqual({ impuesto: 20, destino: "sumidero", reglaId: expect.any(Number) });
    expect(impuestos.calcularImpuesto(G, "trabajo", 100)).toEqual({ impuesto: 5, destino: "bote", reglaId: expect.any(Number) });
});

test("una regla inactiva no se aplica", () => {
    const regla = impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 50 });
    impuestos.activarRegla(G, regla.id, false);
    expect(impuestos.calcularImpuesto(G, "trabajo", 100)).toBeNull();
});

test("quitarRegla borra la regla y deja de aplicarse", () => {
    const regla = impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 50 });
    expect(impuestos.quitarRegla(G, regla.id)).toBe(true);
    expect(impuestos.listarReglas(G)).toEqual([]);
});

test("impuestoDeCompra: una regla de base 'compra', separada de las de ingreso", () => {
    impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 5 });
    expect(impuestos.impuestoDeCompra(G, 1000)).toBeNull(); // no hay ninguna regla de compra todavía

    impuestos.anadirRegla(G, { base: "compra", porcentaje: 10, destino: "bote" });
    expect(impuestos.impuestoDeCompra(G, 1000)).toEqual({ impuesto: 100, destino: "bote", reglaId: expect.any(Number) });
});

test("el bote se acumula por servidor, y a 0 si nunca se ha sumado nada", () => {
    expect(impuestos.boteTotal(G)).toBe(0);
    impuestos.sumarBote(G, 50);
    impuestos.sumarBote(G, 30);
    expect(impuestos.boteTotal(G)).toBe(80);
});

test("si el destino es 'sumidero', pagarConImpuesto no suma nada al bote", () => {
    const dinero = require("../src/systems/dinero");
    impuestos.anadirRegla(G, { base: "ingreso", porcentaje: 100, destino: "sumidero" });
    dinero.pagarConImpuesto("u-sumidero", G, "trabajo", "Prueba", 100);
    expect(impuestos.boteTotal(G)).toBe(0);
});
