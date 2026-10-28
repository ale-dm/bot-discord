// 🤝 Préstamos entre jugadores (#520): proponer con sus límites (interés, plazo, 25 % del banco, topes por persona), aceptar
// (de banco a banco, una sola vez, caducidad de 24 h), rechazar y cancelar, pagar antes (entero o a plazos), cobro al vencer
// (banco y luego efectivo) con deuda y reintento, avisos del vencimiento, el cron con DM y las pantallas y botones.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const avisosDm = require("../src/systems/avisosDm");
const prestamos = require("../src/systems/prestamosJugadores");
const envios = require("../src/discord/envios/prestamosJugadores");
const prestamoCmd = require("../src/commands/economia/prestamo");
const { pantallaPrestamo, dmPropuesta } = require("../src/paneles/prestamosJugadores");

const G = "g-prest";
const AHORA = 1_800_000_000_000;
const DIA = prestamos.DIA_MS;
const A = "pj-ana";
const L = "pj-luis";

const c = (u) => dinero.cuenta(u);
const proponer = (extra = {}) =>
    prestamos.proponer({ guildId: G, prestamista: A, prestatario: L, cantidad: 1000, interes: 10, dias: 7, ...extra }, AHORA);
const activo = () => {
    const p = proponer().prestamo;
    expect(prestamos.aceptar(p.id, L, AHORA + 1).ok).toBe(true);
    return prestamos.obtener(p.id);
};

beforeEach(() => {
    db.prepare("DELETE FROM prestamos_jugadores").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'pj-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'pj-%'").run();
    db.prepare("DELETE FROM preferencias_dm WHERE userId LIKE 'pj-%'").run();
    dinero.pagarBanco(A, 10_000);
});

describe("proponer", () => {
    test("calcula lo que se devuelve y no mueve dinero todavía", () => {
        const r = proponer();
        expect(r.prestamo).toMatchObject({ estado: "propuesto", total: 1100, falta: 1100 });
        expect(c(A).banco).toBe(10_000);
    });

    test("respeta el interés máximo, el plazo, el 25 % del banco y no prestarse a uno mismo", () => {
        expect(proponer({ interes: 51 }).motivo).toMatch(/0 a 50 %/);
        expect(proponer({ dias: 31 }).motivo).toMatch(/1 a 30 días/);
        expect(proponer({ cantidad: 2501 }).motivo).toMatch(/25 % .*\*\*2500\*\*/);
        expect(proponer({ cantidad: 0 }).ok).toBe(false);
        expect(proponer({ prestatario: A }).motivo).toMatch(/a ti mismo/);
    });

    test("como mucho 5 dados o propuestos por prestamista y 3 abiertos por prestatario", () => {
        dinero.pagarBanco(A, 100_000);
        for (let i = 0; i < 3; i++) prestamos.aceptar(proponer().prestamo.id, L, AHORA + 1);
        expect(proponer().motivo).toMatch(/ya debe 3 préstamos/);
        for (let i = 0; i < 2; i++) proponer({ prestatario: `pj-otro${i}` });
        expect(proponer({ prestatario: "pj-otro9" }).motivo).toMatch(/Ya tienes 5 préstamos/);
    });
});

describe("aceptar, rechazar y cancelar", () => {
    test("al aceptar, el dinero pasa de banco a banco una sola vez y empieza el plazo", () => {
        const p = proponer().prestamo;
        expect(prestamos.aceptar(p.id, A).motivo).toMatch(/no es para ti/);
        const r = prestamos.aceptar(p.id, L, AHORA + 5);
        expect(r.prestamo).toMatchObject({ estado: "activo", vence_en: AHORA + 5 + 7 * DIA });
        expect(c(A).banco).toBe(9000);
        expect(c(L).banco).toBe(1000);
        expect(prestamos.aceptar(p.id, L, AHORA + 6).ok).toBe(false);
        expect(c(L).banco).toBe(1000);
        expect(dinero.movimientos(L, { tipo: "prestamo" }).filas[0].cantidad).toBe(1000);
    });

    test("la propuesta caduca a las 24 h y no se acepta si al prestamista ya no le llega", () => {
        const p = proponer().prestamo;
        expect(prestamos.aceptar(p.id, L, AHORA + DIA + 1).motivo).toMatch(/caducado/);
        const otra = proponer().prestamo;
        dinero.cobrarBanco(A, 9000);
        expect(prestamos.aceptar(otra.id, L, AHORA + 1).motivo).toMatch(/25 %/);
    });

    test("quien recibe la rechaza y quien la propuso la cancela; nadie más", () => {
        const p = proponer().prestamo;
        expect(prestamos.descartar(p.id, "pj-nadie").motivo).toMatch(/no es tuya/);
        expect(prestamos.descartar(p.id, L).prestamo.estado).toBe("rechazado");
        expect(prestamos.descartar(proponer().prestamo.id, A).prestamo.estado).toBe("cancelado");
    });
});

describe("pagar y cobrar", () => {
    test("se paga antes del efectivo, a plazos o entero, y al completarlo se cierra", () => {
        const p = activo();
        dinero.pagar(L, 2000);
        expect(prestamos.pagar(p.id, A, 100).motivo).toMatch(/no lo debes tú/);
        expect(prestamos.pagar(p.id, L, 2000).motivo).toMatch(/de 1 a 1100/);
        expect(prestamos.pagar(p.id, L, 600).prestamo).toMatchObject({ pagado: 600, estado: "activo" });
        expect(prestamos.pagar(p.id, L).prestamo).toMatchObject({ pagado: 1100, estado: "devuelto" });
        expect(c(A).banco).toBe(10_100);
    });

    test("al vencer se cobra del banco y luego del efectivo; lo que falta queda como deuda y se reintenta", () => {
        const p = activo();
        dinero.ingresar(L, 0 + 300);
        // Luis tiene 1000 + 300 en el banco y 700 de efectivo: debe 1100.
        dinero.cobrar(L, c(L).efectivo);
        dinero.cobrarBanco(L, 1000);
        dinero.pagar(L, 200);
        const r = prestamos.revisar(p.vence_en);
        expect(r.cobros[0]).toMatchObject({ cobrado: 500, pasaADeuda: true });
        expect(prestamos.obtener(p.id)).toMatchObject({ estado: "deuda", falta: 600 });
        expect(c(L)).toMatchObject({ banco: 0, efectivo: 0 });
        dinero.pagarBanco(L, 1000);
        expect(prestamos.revisar(p.vence_en + 1).cobros[0]).toMatchObject({ cobrado: 600, pasaADeuda: false });
        expect(prestamos.obtener(p.id).estado).toBe("devuelto");
        expect(c(A).banco).toBe(10_100);
    });

    test("un día antes del vencimiento se avisa una sola vez, y las propuestas viejas caducan", () => {
        const p = activo();
        proponer();
        expect(prestamos.revisar(p.vence_en - 2 * DIA)).toMatchObject({ avisar: [], caducadas: 1 });
        expect(prestamos.revisar(p.vence_en - DIA / 2)).toMatchObject({ avisar: [expect.objectContaining({ id: p.id })], caducadas: 0 });
        expect(prestamos.revisar(p.vence_en - DIA / 3).avisar).toEqual([]);
    });
});

describe("Discord", () => {
    test("el cron avisa por DM del cobro y de la deuda a las dos partes", async () => {
        const p = activo();
        dinero.cobrarBanco(L, 1000);
        dinero.cobrar(L, c(L).efectivo);
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        await envios.revisar({}, p.vence_en);
        expect(dm.mock.calls.map((x) => x[1]).sort()).toEqual([A, L]);
        expect(dm.mock.calls.every((x) => x[2] === "prestamo_jugador")).toBe(true);
        dm.mockRestore();
    });

    test("/prestamo proponer manda el DM con los botones de aceptar y rechazar", async () => {
        const intentar = jest.spyOn(avisosDm, "intentarDm").mockResolvedValue("ok");
        const i = {
            guildId: G,
            user: { id: A },
            client: {},
            options: {
                getSubcommand: () => "proponer",
                getUser: () => ({ id: L, bot: false }),
                getInteger: (n) => ({ cantidad: 500, interes: 5, dias: 3 })[n],
            },
            reply: jest.fn(async () => {}),
        };
        await prestamoCmd.run({}, i);
        const dm = intentar.mock.calls[0][2];
        expect(dm.components[0].toJSON().components.map((b) => b.custom_id)).toEqual([
            expect.stringMatching(/^prest_aceptar_\d+$/),
            expect.stringMatching(/^prest_rechazar_\d+$/),
        ]);
        expect(i.reply.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/Propuesta enviada por DM/);
        intentar.mockRestore();
    });

    test("aceptar con el botón mueve el dinero, repinta y avisa a quien prestó", async () => {
        const p = proponer().prestamo;
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        const i = { customId: `prest_aceptar_${p.id}`, user: { id: L }, client: {}, update: jest.fn(async () => {}) };
        await prestamoCmd.handleButton({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/Aceptado/);
        expect(c(L).banco).toBe(1000);
        expect(dm).toHaveBeenCalledWith(
            {},
            A,
            "prestamo_jugador",
            expect.objectContaining({ content: expect.stringMatching(/ha aceptado/) }),
        );
        dm.mockRestore();
    });

    test("la ficha solo enseña las acciones de cada uno", () => {
        const p = proponer().prestamo;
        const ids = (x) => x.components.flatMap((f) => f.toJSON().components.map((b) => b.custom_id));
        expect(ids(pantallaPrestamo(A, p.id))).toEqual([`prest_cancelar_${p.id}`, "prest_inicio"]);
        expect(ids(dmPropuesta(p))).toEqual([`prest_aceptar_${p.id}`, `prest_rechazar_${p.id}`]);
        prestamos.aceptar(p.id, L, AHORA + 1);
        expect(ids(pantallaPrestamo(L, p.id))).toEqual([`prest_pagartodo_${p.id}`, `prest_pagarparte_${p.id}`, "prest_inicio"]);
        expect(ids(pantallaPrestamo(A, p.id))).toEqual(["prest_inicio"]);
        expect(pantallaPrestamo("pj-nadie", p.id).embeds[0].toJSON().description).toMatch(/no es tuyo/);
    });
});
