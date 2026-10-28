// 📋 Encargos semanales (#523): tres por semana (fácil, medio y difícil, distintos y siempre los mismos para la misma persona y
// semana), progreso con la actividad real y sin pasar de la meta, cobro único, caducidad con la semana, el enganche con el
// registro del pase (también con el pase apagado), con robos, trabajo, casino y apuestas, y la pantalla con sus botones.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const guildSettings = require("../src/systems/guildSettings");
const encargos = require("../src/systems/encargos");
const pase = require("../src/systems/pase/pase");
const casinoTx = require("../src/systems/casinoTransactions");
const encargosBotones = require("../src/perfil/encargos");
const { pantallaEncargos } = require("../src/paneles/encargos");

const G = "g-encargos";
const U = "enc-ana";
// Miércoles 2026-10-28 12:00 de Madrid: la semana empieza el lunes 26.
const MIERCOLES = Date.UTC(2026, 9, 28, 11, 0);
const SEMANA_SIGUIENTE = MIERCOLES + 7 * 86400000;

const deCategoria = (cat, ahora = MIERCOLES) => encargos.deLaSemana(G, U, ahora).encargos.find((e) => e.categoria === cat);
/** Una categoría que le haya tocado esta semana. */
const unaDeSusCategorias = (ahora = MIERCOLES) => encargos.deLaSemana(G, U, ahora).encargos[0];

beforeEach(() => {
    db.prepare("DELETE FROM encargos").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'enc-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'enc-%'").run();
});

describe("asignación", () => {
    test("tres encargos distintos por semana, fácil, medio y difícil, con recompensa de 100 a 500", () => {
        const { semana, encargos: lista } = encargos.deLaSemana(G, U, MIERCOLES);
        expect(semana).toBe("2026-10-26");
        expect(lista.map((e) => [e.dificultad, e.recompensa])).toEqual([
            ["facil", 100],
            ["media", 250],
            ["dificil", 500],
        ]);
        expect(new Set(lista.map((e) => e.categoria)).size).toBe(3);
    });

    test("son siempre los mismos para la misma persona y semana, y cambian con la semana", () => {
        expect(encargos.elegir(U, "2026-10-26")).toEqual(encargos.elegir(U, "2026-10-26"));
        const semanas = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"].map((s) =>
            encargos
                .elegir(U, s)
                .map((e) => e.encargo)
                .join(),
        );
        expect(new Set(semanas).size).toBeGreaterThan(1);
    });

    test("la semana acaba el lunes siguiente a las 00:00 de Madrid", () => {
        expect(encargos.deLaSemana(G, U, MIERCOLES).fin).toBe(Date.UTC(2026, 10, 1, 23, 0));
    });
});

describe("progreso y cobro", () => {
    test("la actividad suma, no pasa de la meta y solo cuenta en los encargos de esa categoría", () => {
        const e = unaDeSusCategorias();
        expect(encargos.registrar(G, U, e.categoria, e.meta - 1, MIERCOLES)).toBe(0);
        expect(encargos.registrar(G, U, e.categoria, 1000, MIERCOLES)).toBe(1);
        expect(deCategoria(e.categoria)).toMatchObject({ progreso: e.meta, completado_en: MIERCOLES });
        expect(encargos.registrar(G, U, "categoria_inventada", 5, MIERCOLES)).toBe(0);
    });

    test("se cobra una sola vez, solo completado y con el impuesto de ingresos", () => {
        const e = unaDeSusCategorias();
        expect(encargos.reclamar(G, U, e.slot, MIERCOLES).motivo).toMatch(/no lo has completado/);
        encargos.registrar(G, U, e.categoria, e.meta, MIERCOLES);
        expect(encargos.reclamar(G, U, e.slot, MIERCOLES).ok).toBe(true);
        expect(encargos.reclamar(G, U, e.slot, MIERCOLES).motivo).toMatch(/Ya cobraste/);
        const impuesto = impuestos.calcularImpuesto(G, "premio", e.recompensa)?.impuesto || 0;
        expect(dinero.cuenta(U).efectivo).toBe(1000 + e.recompensa - impuesto);
        expect(dinero.movimientos(U, { tipo: "premio" }).filas[0].cantidad).toBe(e.recompensa);
    });

    test("lo que no se completa caduca con la semana: la siguiente empieza de cero y no se cobra lo de antes", () => {
        const e = unaDeSusCategorias();
        encargos.registrar(G, U, e.categoria, e.meta, MIERCOLES);
        expect(encargos.reclamar(G, U, e.slot, SEMANA_SIGUIENTE).ok).toBe(false);
        expect(encargos.deLaSemana(G, U, SEMANA_SIGUIENTE).encargos.every((x) => x.progreso === 0)).toBe(true);
    });
});

describe("enganches", () => {
    test("el registro de actividad del pase avanza los encargos aunque el pase esté apagado", () => {
        const e = unaDeSusCategorias(Date.now());
        guildSettings.setSetting(G, "pase.activo", false);
        pase.registrarSeguro(G, U, e.categoria, e.meta);
        expect(deCategoria(e.categoria, Date.now()).completado_en).not.toBeNull();
        guildSettings.setSetting(G, "pase.activo", true);
    });

    test("las ganancias del casino cuentan en «gana en el casino» y las pérdidas no", () => {
        db.prepare("INSERT OR IGNORE INTO xp_users (guildId, userId) VALUES (?, ?)").run(G, U);
        const registrar = jest.spyOn(encargos, "registrarEnTodos");
        dinero.cuenta(U);
        casinoTx.procesarGanancia(U, "tragaperras", 100, 350, "Tragaperras", { guildId: G });
        casinoTx.procesarPerdida(U, "tragaperras", 100, "Tragaperras", { guildId: G });
        expect(registrar.mock.calls).toEqual([[U, "casino_gana", 250]]);
        registrar.mockRestore();
    });
});

describe("pantalla", () => {
    test("enseña los tres con su barra y solo deja cobrar el completado", () => {
        const e = unaDeSusCategorias(Date.now());
        encargos.registrar(G, U, e.categoria, e.meta);
        const p = pantallaEncargos(G, U);
        expect(p.embeds[0].toJSON().fields).toHaveLength(3);
        const botones = p.components[0].toJSON().components;
        expect(botones.map((b) => [b.custom_id, Boolean(b.disabled)])).toEqual(
            expect.arrayContaining([
                [`encargos_cobrar_${e.slot}`, false],
                [`perfil_eco_${U}_${U}`, false],
            ]),
        );
        expect(botones.filter((b) => b.disabled)).toHaveLength(2);
    });

    test("el botón de cobrar paga y repinta; en el panel de otro no deja tocar nada", async () => {
        const e = unaDeSusCategorias(Date.now());
        encargos.registrar(G, U, e.categoria, e.meta);
        const i = (userId) => ({
            customId: `encargos_cobrar_${e.slot}`,
            guildId: G,
            user: { id: userId },
            message: { interaction: { user: { id: U } } },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
        });
        const ajeno = i("enc-luis");
        await encargosBotones.handleButton({}, ajeno);
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/no es tuyo/);
        const propio = i(U);
        await encargosBotones.handleButton({}, propio);
        expect(propio.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/¡Cobrado!/);
    });
});
