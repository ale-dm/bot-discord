// Patrimonio (F-EC-10, #81): interés sobre el banco e impuesto sobre lo que pasa del umbral, con los negocios en la
// base, el ciclo semanal por persona, el destino del impuesto y la validación de la configuración.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const negocios = require("../src/systems/negocios");
const patrimonio = require("../src/systems/patrimonio");
const impuestos = require("../src/systems/impuestos");

const G = "guild-patrimonio";
const T0 = Date.parse("2026-10-07T12:00:00Z");
const DIA = 24 * 3600 * 1000;

let n = 0;
function nuevo(banco = 0, { guild = G } = {}) {
    const id = `patri-${++n}`;
    if (banco) dinero.pagarBanco(id, banco);
    db.prepare("INSERT OR IGNORE INTO xp_users (guildId, userId, xp, nivel, xp_total, ultimo_msg) VALUES (?, ?, 0, 0, 0, ?)").run(
        guild,
        id,
        T0,
    );
    return id;
}

beforeEach(() => {
    db.prepare("DELETE FROM config WHERE clave = 'patrimonio'").run();
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM patrimonio_usuario").run();
    db.prepare("DELETE FROM negocios_usuario").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
});

describe("ciclo (aplicarCiclo)", () => {
    test("paga primero el interés del banco y después el impuesto sobre lo que pasa del umbral", () => {
        // banco 100.000 → interés 0,5 % = 500 → banco 100.500 → exceso sobre 50.000 = 50.500 → 1 % = 505.
        const u = nuevo(100000);
        const r = patrimonio.aplicarCiclo(u, patrimonio.configuracion());
        expect(r).toEqual({ interes: 500, cobrado: 505 });
        expect(dinero.banco(u)).toBe(100000 + 500 - 505);
    });

    test("por debajo del umbral no paga impuesto, pero sí interés", () => {
        const u = nuevo(40000); // interés 200; base 40.200 < 50.000
        expect(patrimonio.aplicarCiclo(u, patrimonio.configuracion())).toEqual({ interes: 200, cobrado: 0 });
        expect(dinero.banco(u)).toBe(40200);
    });

    test("los negocios cuentan en la base del impuesto (su valor pagado), no en el interés", () => {
        const u = nuevo(60000);
        negocios.comprar(u, G, "lavanderia", T0); // 15.000 del banco → banco 45.000, negocio pagado 15.000
        // interés 225 → banco 45.225; base 45.225 + 15.000 = 60.225; exceso 10.225 → 1 % = 102
        expect(patrimonio.aplicarCiclo(u, patrimonio.configuracion())).toEqual({ interes: 225, cobrado: 102 });
        expect(dinero.banco(u)).toBe(45225 - 102);
    });

    test("lo que no hay en el banco no se cobra y no genera deuda", () => {
        patrimonio.guardarConfiguracion({ umbral: 0, porcentaje: 100, interes: 0, dias: 7, destino: "bote" });
        const u = nuevo(15000);
        negocios.comprar(u, G, "lavanderia", T0); // banco 0, negocio pagado 15.000
        dinero.pagarBanco(u, 100);
        // impuesto 100 % de 15.100 = 15.100, pero solo hay 100 en el banco.
        expect(patrimonio.aplicarCiclo(u, patrimonio.configuracion())).toEqual({ interes: 0, cobrado: 100 });
        expect(dinero.banco(u)).toBe(0);
    });

    test("el impuesto va al bote del servidor donde se usó la economía", () => {
        const u = nuevo(100000);
        patrimonio.aplicarCiclo(u, patrimonio.configuracion());
        expect(impuestos.boteTotal(G)).toBe(505);
    });

    test("con destino sumidero, el impuesto desaparece y el bote no cambia", () => {
        patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, destino: "sumidero" });
        const u = nuevo(100000);
        patrimonio.aplicarCiclo(u, patrimonio.configuracion());
        expect(impuestos.boteTotal(G)).toBe(0);
    });

    test("apunta el interés y el impuesto en Movimientos con su tipo", () => {
        const u = nuevo(100000);
        patrimonio.aplicarCiclo(u, patrimonio.configuracion());
        const tipos = db.prepare("SELECT tipo, cantidad FROM historial WHERE userId = ? ORDER BY id").all(u);
        expect(tipos).toEqual([
            { tipo: "patrimonio", cantidad: 500 },
            { tipo: "impuesto", cantidad: -505 },
        ]);
    });
});

describe("ciclo semanal por persona (revisar)", () => {
    test("la primera vez que aparece solo marca su fecha, sin cobrar", () => {
        const u = nuevo(100000);
        expect(patrimonio.revisar(T0)).toEqual({ ciclos: 0, interes: 0, cobrado: 0 });
        expect(dinero.banco(u)).toBe(100000);
        expect(db.prepare("SELECT ultimo_ciclo FROM patrimonio_usuario WHERE userId = ?").get(u).ultimo_ciclo).toBe(T0);
    });

    test("no toca a nadie antes de cumplirse los días configurados, y sí después", () => {
        const u = nuevo(100000);
        patrimonio.revisar(T0); // marca
        expect(patrimonio.revisar(T0 + 6 * DIA)).toEqual({ ciclos: 0, interes: 0, cobrado: 0 });
        expect(dinero.banco(u)).toBe(100000);

        const r = patrimonio.revisar(T0 + 7 * DIA);
        expect(r).toEqual({ ciclos: 1, interes: 500, cobrado: 505 });
        // Tras el ciclo, el siguiente llega 7 días después del último.
        expect(patrimonio.revisar(T0 + 8 * DIA).ciclos).toBe(0);
    });

    test("los días entre cobros salen de la configuración", () => {
        patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, dias: 1 });
        nuevo(100000);
        patrimonio.revisar(T0);
        expect(patrimonio.revisar(T0 + DIA).ciclos).toBe(1);
    });
});

describe("configuración", () => {
    test("sin guardar nada usa los valores por defecto", () => {
        expect(patrimonio.configuracion()).toEqual(patrimonio.DEFECTO);
    });

    test("guarda una configuración válida y la devuelve", () => {
        const r = patrimonio.guardarConfiguracion({ umbral: "80000", porcentaje: "2", interes: "1", dias: "14", destino: "Sumidero" });
        expect(r.ok).toBe(true);
        expect(patrimonio.configuracion()).toEqual({ umbral: 80000, porcentaje: 2, interes: 1, dias: 14, destino: "sumidero" });
    });

    test("rechaza valores fuera de rango", () => {
        expect(patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, porcentaje: 150 }).ok).toBe(false);
        expect(patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, dias: 0 }).ok).toBe(false);
        expect(patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, umbral: -1 }).ok).toBe(false);
        expect(patrimonio.guardarConfiguracion({ ...patrimonio.DEFECTO, destino: "otro" }).ok).toBe(false);
        expect(patrimonio.configuracion()).toEqual(patrimonio.DEFECTO);
    });
});
