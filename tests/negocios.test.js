// Negocios y blanqueo (F-EC-06d, #80): compra y venta con el banco, tope diario de blanqueo (reinicio a las 00:00
// de Madrid), limpieza repartida en 24 h con su impuesto, y el ingreso diario una vez por día.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const negocios = require("../src/systems/negocios");

const G = "guild-negocios";
// 2026-10-07 14:00 en Madrid (UTC+2).
const T0 = Date.parse("2026-10-07T12:00:00Z");
const DIA = 24 * 3600 * 1000;

let n = 0;
function nuevo({ banco = 0, negro = 0 } = {}) {
    const id = `negocio-${++n}`;
    if (banco) dinero.pagarBanco(id, banco);
    if (negro) dinero.pagarNegro(id, negro);
    return id;
}

beforeEach(() => {
    db.prepare("DELETE FROM negocios_usuario").run();
    db.prepare("DELETE FROM blanqueo_lotes").run();
    db.prepare("DELETE FROM blanqueo_dia").run();
    db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
});

describe("compra y venta", () => {
    test("comprar cobra del banco, no del efectivo, y no deja repetir el mismo negocio", () => {
        const u = nuevo({ banco: 20000 });
        const efectivo = dinero.efectivo(u);
        expect(negocios.comprar(u, G, "lavanderia", T0)).toMatchObject({ ok: true });
        expect(dinero.banco(u)).toBe(20000 - 15000);
        expect(dinero.efectivo(u)).toBe(efectivo);
        expect(negocios.comprar(u, G, "lavanderia", T0).ok).toBe(false);
    });

    test("sin banco suficiente no compra ni cobra nada", () => {
        const u = nuevo({ banco: 1000 });
        const r = negocios.comprar(u, G, "lavanderia", T0);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/banco/);
        expect(dinero.banco(u)).toBe(1000);
        expect(negocios.estado(u).negocios).toEqual([]);
    });

    test("vender devuelve el 50 % de lo pagado al banco y quita el negocio", () => {
        const u = nuevo({ banco: 15000 });
        negocios.comprar(u, G, "lavanderia", T0);
        expect(negocios.vender(u, "lavanderia")).toMatchObject({ ok: true });
        expect(dinero.banco(u)).toBe(7500);
        expect(negocios.estado(u).negocios).toEqual([]);
    });

    test("no se puede vender lo que no se tiene", () => {
        const u = nuevo();
        expect(negocios.vender(u, "taco").ok).toBe(false);
    });
});

describe("tope diario de blanqueo", () => {
    test("la capacidad es la suma de los negocios que se tienen", () => {
        const u = nuevo({ banco: 60000 });
        negocios.comprar(u, G, "lavanderia", T0); // 7.500/día
        negocios.comprar(u, G, "correos", T0); // 15.000/día
        expect(negocios.capacidadDiaria(u)).toBe(22500);
    });

    test("sin negocios no se puede depositar", () => {
        const u = nuevo({ negro: 100 });
        expect(negocios.depositar(u, G, 100, T0).ok).toBe(false);
    });

    test("no se puede depositar más de lo que queda de capacidad hoy", () => {
        const u = nuevo({ banco: 15000, negro: 20000 });
        negocios.comprar(u, G, "lavanderia", T0); // 7.500/día
        expect(negocios.depositar(u, G, 7500, T0).ok).toBe(true);
        const r = negocios.depositar(u, G, 1, T0);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/capacidad/);
    });

    test("el tope se reinicia a las 00:00 de Madrid, no a las 24 h", () => {
        const u = nuevo({ banco: 15000, negro: 20000 });
        negocios.comprar(u, G, "lavanderia", T0);
        const alas2330Madrid = Date.parse("2026-10-07T21:30:00Z");
        const alas0030Madrid = Date.parse("2026-10-07T22:30:00Z"); // ya es 8 de octubre en Madrid
        expect(negocios.depositar(u, G, 7500, alas2330Madrid).ok).toBe(true);
        expect(negocios.depositar(u, G, 1, alas2330Madrid).ok).toBe(false);
        expect(negocios.depositar(u, G, 7500, alas0030Madrid).ok).toBe(true);
    });

    test("depositar pasa el dinero negro a limpieza: el negro baja y el efectivo no cambia", () => {
        const u = nuevo({ banco: 15000, negro: 1000 });
        negocios.comprar(u, G, "lavanderia", T0);
        const efectivo = dinero.efectivo(u);
        expect(negocios.depositar(u, G, 1000, T0).ok).toBe(true);
        expect(dinero.negro(u)).toBe(0);
        expect(dinero.efectivo(u)).toBe(efectivo);
        expect(negocios.estado(u).enLimpieza).toBe(1000);
    });

    test("no se puede depositar más dinero negro del que se tiene", () => {
        const u = nuevo({ banco: 15000, negro: 100 });
        negocios.comprar(u, G, "lavanderia", T0);
        const r = negocios.depositar(u, G, 500, T0);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/dinero negro/);
    });
});

describe("limpieza (blanqueo) en 24 h", () => {
    test("libera la parte proporcional al tiempo, con su impuesto, y el resto al cumplirse las 24 h", () => {
        const u = nuevo({ banco: 15000, negro: 1000 });
        negocios.comprar(u, G, "lavanderia", T0);
        negocios.depositar(u, G, 1000, T0);
        const antes = dinero.efectivo(u);

        // A las 12 h se libera la mitad: 500, y se paga el 5 % de impuesto por defecto (25).
        negocios.avanzarLotes(T0 + DIA / 2);
        expect(dinero.efectivo(u)).toBe(antes + 500 - Math.floor((500 * 5) / 100));

        // A las 24 h, el resto.
        negocios.avanzarLotes(T0 + DIA);
        expect(dinero.efectivo(u)).toBe(antes + 1000 - Math.floor((1000 * 5) / 100));
        expect(negocios.estado(u).enLimpieza).toBe(0);
    });

    test("llamar otra vez en el mismo momento no paga dos veces", () => {
        const u = nuevo({ banco: 15000, negro: 1000 });
        negocios.comprar(u, G, "lavanderia", T0);
        negocios.depositar(u, G, 1000, T0);
        negocios.avanzarLotes(T0 + DIA / 2);
        const despues = dinero.efectivo(u);
        expect(negocios.avanzarLotes(T0 + DIA / 2)).toBe(0);
        expect(dinero.efectivo(u)).toBe(despues);
    });

    test("el blanqueo queda en Movimientos con su tipo", () => {
        const u = nuevo({ banco: 15000, negro: 1000 });
        negocios.comprar(u, G, "lavanderia", T0);
        negocios.depositar(u, G, 1000, T0);
        negocios.avanzarLotes(T0 + DIA);
        const tipos = db
            .prepare("SELECT tipo FROM historial WHERE userId = ?")
            .all(u)
            .map((h) => h.tipo);
        expect(tipos).toContain("blanqueo");
        expect(tipos).toContain("impuesto");
    });
});

describe("ingreso diario", () => {
    test("un negocio paga su ingreso una vez al día (hora de Madrid), y el primer pago es el día siguiente a comprarlo", () => {
        const u = nuevo({ banco: 15000 });
        negocios.comprar(u, G, "lavanderia", T0); // 100/día, con 5 % de impuesto por defecto
        const antes = dinero.efectivo(u);

        expect(negocios.pagarIngresosDiarios(T0)).toBe(0); // mismo día de la compra: aún no
        expect(dinero.efectivo(u)).toBe(antes);

        const dia2 = T0 + 12 * 3600 * 1000; // 02:00 del día siguiente en Madrid
        expect(negocios.pagarIngresosDiarios(dia2)).toBe(1);
        expect(dinero.efectivo(u)).toBe(antes + 100 - Math.floor((100 * 5) / 100));

        expect(negocios.pagarIngresosDiarios(dia2 + 3600 * 1000)).toBe(0); // mismo día: no se repite
    });

    test("revisar devuelve lo blanqueado y los ingresos pagados", () => {
        const u = nuevo({ banco: 15000, negro: 1000 });
        negocios.comprar(u, G, "lavanderia", T0);
        negocios.depositar(u, G, 1000, T0);
        // 24 h después ya es el día siguiente en Madrid: se blanquea lo depositado y toca el ingreso diario.
        const r = negocios.revisar(T0 + DIA);
        expect(r.blanqueado).toBe(1000);
        expect(r.ingresos).toBe(1);
    });
});

describe("panel 🏪 Negocios", () => {
    const paneles = require("../src/paneles/negocios");
    const valoresMenu = (payload) => payload.components[0].toJSON().components[0].options.map((o) => o.value);

    test("el menú ofrece vender los que ya tienes y comprar el resto", () => {
        const u = nuevo({ banco: 15000 });
        negocios.comprar(u, G, "lavanderia", T0);
        const valores = valoresMenu(paneles.buildNegocios(u));
        expect(valores).toContain("vender_lavanderia");
        expect(valores).toContain("comprar_correos");
        expect(valores).not.toContain("comprar_lavanderia");
    });

    test("depositar está desactivado sin negocios o sin dinero negro", () => {
        const u = nuevo({ banco: 15000, negro: 500 });
        const boton = (payload) => payload.components[1].toJSON().components[0];
        expect(boton(paneles.buildNegocios(u)).disabled).toBe(true);
        negocios.comprar(u, G, "lavanderia", T0);
        expect(boton(paneles.buildNegocios(u)).disabled).toBe(false);
        const sinNegro = nuevo({ banco: 15000 });
        negocios.comprar(sinNegro, G, "lavanderia", T0);
        expect(boton(paneles.buildNegocios(sinNegro)).disabled).toBe(true);
    });
});
