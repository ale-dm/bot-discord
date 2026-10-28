// 🎟️ Lotería semanal (#524): fecha del sorteo (domingo 21:00 de Madrid), números válidos, compra solo con efectivo y con
// tope, sorteo con un acertante, con varios (reparto y resto), sin acertantes (el bote se acumula), sin boletos, la aportación
// del bote de impuestos con su tope, que no se sortee dos veces, el cron con anuncio y DM, y el panel y el comando.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const guildSettings = require("../src/systems/guildSettings");
const avisosDm = require("../src/systems/avisosDm");
const loteria = require("../src/systems/loteria");
const envios = require("../src/discord/envios/loteria");
const loteriaCmd = require("../src/commands/economia/loteria");
const { pantallaLoteria } = require("../src/paneles/loteria");

const G = "g-loteria";
// Miércoles 2026-10-28 12:00 en Madrid (11:00 UTC, horario de invierno).
const MIERCOLES = Date.UTC(2026, 9, 28, 11, 0);
const DOMINGO_21 = Date.UTC(2026, 10, 1, 20, 0);

/** Un azar que devuelve, por orden, los índices que hacen salir esos números del bombo (1..20). */
function azarPara(numeros) {
    const bombo = Array.from({ length: 20 }, (_, i) => i + 1);
    const valores = numeros.map((n) => {
        const i = bombo.indexOf(n);
        bombo.splice(i, 1);
        return (i + 0.5) / (bombo.length + 1);
    });
    let k = 0;
    return () => valores[k++ % valores.length];
}

const efectivo = (u) => dinero.cuenta(u).efectivo;
const impuestoDe = (premio) => impuestos.calcularImpuesto(G, "loteria", premio)?.impuesto || 0;
const comprar = (userId, numeros, ahora = MIERCOLES) => loteria.comprar({ guildId: G, userId, numeros, ahora });
const sortear = (combinacion, ahora = DOMINGO_21) =>
    loteria.sortear(loteria.abierto(G, MIERCOLES).id, { azar: azarPara(combinacion), ahora });

beforeEach(() => {
    db.prepare("DELETE FROM loteria_boletos").run();
    db.prepare("DELETE FROM loteria_sorteos").run();
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM banco WHERE userId LIKE 'lot-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'lot-%'").run();
    db.prepare("DELETE FROM preferencias_dm WHERE userId LIKE 'lot-%'").run();
    guildSettings.invalidarAjustes(G);
});

describe("fechas y números", () => {
    test("el sorteo es el próximo domingo a las 21:00 de Madrid, también en verano, y el domingo después de las 21 pasa al siguiente", () => {
        expect(loteria.proximoSorteo(MIERCOLES)).toBe(DOMINGO_21);
        expect(loteria.proximoSorteo(DOMINGO_21 - 60000)).toBe(DOMINGO_21);
        expect(loteria.proximoSorteo(DOMINGO_21)).toBe(DOMINGO_21 + 7 * 86400000);
        // Domingo 2026-06-07 21:00 en Madrid es 19:00 UTC (horario de verano).
        expect(loteria.proximoSorteo(Date.UTC(2026, 5, 3, 10))).toBe(Date.UTC(2026, 5, 7, 19, 0));
    });

    test("un boleto son 4 números distintos del 1 al 20, en cualquier orden y separados como se quiera", () => {
        expect(loteria.leerNumeros("20, 3 12-7")).toEqual([3, 7, 12, 20]);
        expect(loteria.leerNumeros("1 2 3")).toBeNull();
        expect(loteria.leerNumeros("1 2 3 21")).toBeNull();
        expect(loteria.leerNumeros("1 2 3 3")).toBeNull();
        expect(loteria.leerNumeros("1 2 3 x")).toBeNull();
        const azar = loteria.alAzar(() => 0.99);
        expect(new Set(azar).size).toBe(4);
        expect(azar.every((n) => n >= 1 && n <= 20)).toBe(true);
    });
});

describe("comprar", () => {
    test("cobra el precio del efectivo, lo suma al bote y lo apunta en Movimientos como lotería", () => {
        const r = comprar("lot-ana", "1 2 3 4");
        expect(r).toMatchObject({ ok: true, boleto: { numeros: "1-2-3-4", precio: 100 } });
        expect(efectivo("lot-ana")).toBe(900);
        expect(r.sorteo.bote).toBe(100);
        expect(dinero.movimientos("lot-ana", { tipo: "loteria" }).filas[0]).toMatchObject({ cantidad: -100 });
    });

    test("no se paga con dinero negro ni sin efectivo suficiente", () => {
        dinero.cobrar("lot-ana", 1000);
        dinero.pagarNegro("lot-ana", 500);
        expect(comprar("lot-ana", "1 2 3 4").motivo).toMatch(/en efectivo/);
        expect(dinero.cuenta("lot-ana")).toMatchObject({ efectivo: 0, negro: 500 });
        expect(loteria.abierto(G, MIERCOLES).bote).toBe(0);
    });

    test("hay un tope de boletos por persona y sorteo, configurable", () => {
        guildSettings.setSetting(G, "loteria.max_boletos", 2);
        expect(comprar("lot-ana", "1 2 3 4").ok).toBe(true);
        expect(comprar("lot-ana", "1 2 3 5").ok).toBe(true);
        expect(comprar("lot-ana", "1 2 3 6").motivo).toMatch(/Ya tienes 2 boletos/);
        expect(efectivo("lot-ana")).toBe(800);
    });

    test("ya no se compra cuando ha llegado la hora del sorteo", () => {
        loteria.abierto(G, MIERCOLES);
        expect(comprar("lot-ana", "1 2 3 4", DOMINGO_21).motivo).toMatch(/a punto de celebrarse/);
    });
});

describe("sortear", () => {
    test("quien acierta los 4 números se lleva el bote; el siguiente sorteo empieza a 0", () => {
        comprar("lot-ana", "1 2 3 4");
        comprar("lot-luis", "5 6 7 8");
        const r = sortear([4, 3, 2, 1]);
        expect(r).toMatchObject({ combinacion: "1-2-3-4", total: 200, ganadores: [{ userId: "lot-ana", premio: 200 }] });
        // El premio paga el impuesto de ingresos del servidor, como cualquier premio.
        expect(efectivo("lot-ana")).toBe(1100 - impuestoDe(200));
        expect(r.siguiente).toMatchObject({ bote: 0, sorteo_en: DOMINGO_21 + 7 * 86400000 });
        expect(dinero.movimientos("lot-ana", { tipo: "loteria" }).filas[0]).toMatchObject({ cantidad: 200 });
    });

    test("con varios acertantes se reparte a partes iguales y lo que no se puede repartir pasa al siguiente", () => {
        guildSettings.setSetting(G, "loteria.precio", 101);
        comprar("lot-ana", "1 2 3 4");
        comprar("lot-luis", "1 2 3 4");
        comprar("lot-eva", "9 10 11 12");
        const r = sortear([1, 2, 3, 4]);
        expect(r.ganadores).toEqual([
            { userId: "lot-ana", premio: 151 },
            { userId: "lot-luis", premio: 151 },
        ]);
        expect(r.siguiente.bote).toBe(1);
    });

    test("si nadie acierta, el bote entero (con la aportación de impuestos) se acumula para la semana siguiente", () => {
        impuestos.sumarBote(G, 5000);
        comprar("lot-ana", "1 2 3 4");
        const r = sortear([5, 6, 7, 8]);
        expect(r).toMatchObject({ ganadores: [], aportacion: 500, total: 600 });
        expect(impuestos.boteTotal(G)).toBe(4500);
        expect(r.siguiente).toMatchObject({ bote: 600, arrastre: 600 });
    });

    test("la aportación de impuestos tiene un tope de 100.000 y no se cobra si nadie compró boletos", () => {
        impuestos.sumarBote(G, 5_000_000);
        expect(sortear([1, 2, 3, 4]).aportacion).toBe(0);
        expect(impuestos.boteTotal(G)).toBe(5_000_000);
        comprar("lot-ana", "9 10 11 12", MIERCOLES + 7 * 86400000);
        const s = loteria.abierto(G);
        expect(loteria.sortear(s.id, { azar: azarPara([1, 2, 3, 4]), ahora: s.sorteo_en }).aportacion).toBe(100_000);
    });

    test("un sorteo no se celebra dos veces ni paga dos veces", () => {
        comprar("lot-ana", "1 2 3 4");
        const id = loteria.abierto(G, MIERCOLES).id;
        expect(loteria.sortear(id, { azar: azarPara([1, 2, 3, 4]), ahora: DOMINGO_21 })).not.toBeNull();
        expect(loteria.sortear(id, { azar: azarPara([1, 2, 3, 4]), ahora: DOMINGO_21 })).toBeNull();
        expect(efectivo("lot-ana")).toBe(1000 - impuestoDe(100));
    });
});

describe("cron, panel y comando", () => {
    const cliente = (canal) => ({ channels: { fetch: jest.fn(async () => canal) }, users: { fetch: jest.fn() } });

    test("el cron celebra el sorteo vencido, lo anuncia (como atrasado si el bot estaba apagado) y avisa por DM al ganador", async () => {
        guildSettings.setSetting(G, "loteria.canal", "c-lot");
        comprar("lot-ana", "1 2 3 4");
        const canal = { send: jest.fn(async () => {}) };
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        expect(await envios.revisar(cliente(canal), DOMINGO_21 + 3 * 3600000, { azar: azarPara([1, 2, 3, 4]) })).toBe(1);
        expect(canal.send.mock.calls[0][0].content).toMatch(/atrasado[\s\S]*<@lot-ana> — \*\*100\*\*/);
        expect(dm).toHaveBeenCalledWith(
            expect.anything(),
            "lot-ana",
            "loteria",
            expect.objectContaining({ content: expect.stringMatching(/Te ha tocado/) }),
        );
        expect(await envios.revisar(cliente(canal), DOMINGO_21 + 3 * 3600000)).toBe(0);
        dm.mockRestore();
    });

    test("el panel enseña el bote, tus boletos y desactiva comprar al llegar al tope", () => {
        guildSettings.setSetting(G, "loteria.max_boletos", 1);
        comprar("lot-ana", "1 2 3 4", Date.now());
        const p = pantallaLoteria(G, "lot-ana");
        const e = p.embeds[0].toJSON();
        expect(e.description).toMatch(/Bote: 100\*\*/);
        expect(e.fields[0]).toMatchObject({ name: "Tus boletos (1/1)", value: "` 1` ` 2` ` 3` ` 4`" });
        expect(p.components[0].toJSON().components.map((c) => [c.custom_id, Boolean(c.disabled)])).toEqual([
            ["loteria_azar", true],
            ["loteria_elegir", true],
            ["loteria_actualizar", false],
        ]);
    });

    test("elegir números en el formulario compra el boleto; con números mal escritos avisa sin cobrar", async () => {
        const i = (texto) => ({
            guildId: G,
            user: { id: "lot-ana" },
            fields: { getTextInputValue: () => texto },
            update: jest.fn(async () => {}),
        });
        const mal = i("1 2 99 4");
        await loteriaCmd.handleModal({}, mal);
        expect(mal.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/❌ Escribe 4 números/);
        const bien = i("4 3 2 1");
        await loteriaCmd.handleModal({}, bien);
        expect(bien.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/Boleto comprado! \*\*1 · 2 · 3 · 4\*\*/);
        expect(efectivo("lot-ana")).toBe(900);
    });
});
