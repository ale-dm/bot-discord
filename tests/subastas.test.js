// 🔨 Casa de subastas (#519): crear (objeto retenido, sin los de protección, con tope y validaciones), pujar (dinero retenido
// del efectivo, devolución al superado, puja mínima, anti-sniping con tope, objetos únicos), cancelar sin pujas, cerrar con
// ganador (objeto, pago menos comisión al bote de impuestos) o sin pujas, sin doble cierre, el cron con DM y las pantallas.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const avisosDm = require("../src/systems/avisosDm");
const subastas = require("../src/systems/subastas");
const envios = require("../src/discord/envios/subastas");
const subastasCmd = require("../src/commands/economia/subastas");
const { pantallaSubastas, pantallaSubasta } = require("../src/paneles/subastas");

const G = "g-subastas";
const AHORA = 1_800_000_000_000;
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const PIEDRA = 9101;
const ESCUDO = 9102;
const CORONA = 9103;

const efectivo = (u) => dinero.cuenta(u).efectivo;
const tiene = (u, objetoId) => db.prepare("SELECT COUNT(*) FROM inventario WHERE userId = ? AND itemId = ?").pluck().get(u, objetoId);
const dar = (u, objetoId) => db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, '2026-10-01')").run(u, objetoId);
const nueva = (extra = {}) =>
    subastas.crear({ guildId: G, userId: "sub-vende", objetoId: PIEDRA, precio: 100, incremento: 10, horas: 24, ...extra }, AHORA);

beforeAll(() => {
    db.prepare("INSERT OR IGNORE INTO objeto (id, nombre, descripcion, tipo) VALUES (?, 'Piedra bonita', 'brilla', 'otro')").run(PIEDRA);
    db.prepare(
        "INSERT OR IGNORE INTO objeto (id, nombre, descripcion, tipo, efecto) VALUES (?, 'Escudo', 'x', 'consumible', 'antirrobo:50')",
    ).run(ESCUDO);
    db.prepare("INSERT OR IGNORE INTO objeto (id, nombre, descripcion, tipo, unico) VALUES (?, 'Corona', 'x', 'otro', 1)").run(CORONA);
});

beforeEach(() => {
    db.prepare("DELETE FROM subasta_pujas").run();
    db.prepare("DELETE FROM subastas").run();
    db.prepare("DELETE FROM inventario WHERE userId LIKE 'sub-%'").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'sub-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'sub-%'").run();
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
    dar("sub-vende", PIEDRA);
});

describe("crear", () => {
    test("el objeto sale del inventario y queda retenido en la subasta, que dura 24 o 48 horas", () => {
        const r = nueva({ horas: 48 });
        expect(r.subasta).toMatchObject({ nombre: "Piedra bonita", estado: "abierta", cierra: AHORA + 48 * HORA });
        expect(tiene("sub-vende", PIEDRA)).toBe(0);
    });

    test("valida precio, incremento, duración, que tengas el objeto y que no sea de protección", () => {
        expect(nueva({ precio: 0 }).motivo).toMatch(/precio de salida/);
        expect(nueva({ incremento: 1.5 }).motivo).toMatch(/incremento/);
        expect(nueva({ horas: 12 }).motivo).toMatch(/24 o 48/);
        expect(nueva({ objetoId: CORONA }).motivo).toMatch(/Ya no tienes/);
        dar("sub-vende", ESCUDO);
        expect(nueva({ objetoId: ESCUDO }).motivo).toMatch(/protección/);
        expect(tiene("sub-vende", ESCUDO)).toBe(1);
    });

    test("como mucho 5 subastas abiertas por persona", () => {
        for (let i = 0; i < 5; i++) {
            dar("sub-vende", PIEDRA);
            expect(nueva().ok).toBe(true);
        }
        expect(nueva().motivo).toMatch(/Ya tienes 5 subastas/);
    });
});

describe("pujar", () => {
    test("retiene la puja del efectivo y devuelve la suya al superado", () => {
        const s = nueva().subasta;
        expect(subastas.pujar(s.id, "sub-ana", 100, AHORA + MIN)).toMatchObject({ ok: true, superado: null });
        expect(efectivo("sub-ana")).toBe(900);
        const r = subastas.pujar(s.id, "sub-luis", 110, AHORA + 2 * MIN);
        expect(r.superado).toEqual({ userId: "sub-ana", cantidad: 100 });
        expect(efectivo("sub-ana")).toBe(1000);
        expect(efectivo("sub-luis")).toBe(890);
        expect(dinero.movimientos("sub-ana", { tipo: "venta" }).filas.map((f) => f.cantidad)).toEqual([100, -100]);
    });

    test("hay que llegar a la puja mínima, no se puja en lo tuyo ni contra ti mismo, ni sin efectivo", () => {
        const s = nueva().subasta;
        expect(subastas.pujar(s.id, "sub-ana", 99, AHORA).motivo).toMatch(/mínima es de \*\*100/);
        expect(subastas.pujar(s.id, "sub-vende", 100, AHORA).motivo).toMatch(/propia/);
        subastas.pujar(s.id, "sub-ana", 100, AHORA);
        expect(subastas.pujar(s.id, "sub-luis", 105, AHORA).motivo).toMatch(/mínima es de \*\*110/);
        expect(subastas.pujar(s.id, "sub-ana", 200, AHORA).motivo).toMatch(/Ya vas ganando/);
        dinero.cobrar("sub-luis", 1000);
        dinero.pagarNegro("sub-luis", 5000);
        expect(subastas.pujar(s.id, "sub-luis", 110, AHORA).motivo).toMatch(/efectivo/);
    });

    test("una puja en los 2 últimos minutos alarga el cierre 2 minutos, como mucho 30 en total", () => {
        const s = nueva().subasta;
        let cierre = s.cierra;
        let quien = 0;
        let cantidad = 100;
        for (let i = 0; i < 20; i++) {
            const r = subastas.pujar(s.id, `sub-p${quien++ % 2}`, cantidad, cierre - MIN);
            cantidad += 10;
            cierre = r.subasta.cierra;
        }
        expect(cierre).toBe(s.cierre_original + 30 * MIN);
        expect(subastas.pujar(s.id, "sub-ana", 1000, AHORA + HORA).prorrogada).toBe(false);
    });

    test("no se puja por un objeto único que ya tienes", () => {
        dar("sub-vende", CORONA);
        dar("sub-ana", CORONA);
        const s = nueva({ objetoId: CORONA }).subasta;
        expect(subastas.pujar(s.id, "sub-ana", 100, AHORA).motivo).toMatch(/único/);
    });
});

describe("cancelar y cerrar", () => {
    test("quien vende cancela mientras nadie haya pujado y el objeto vuelve", () => {
        const s = nueva().subasta;
        expect(subastas.cancelar(s.id, "sub-ana").motivo).toMatch(/no es tuya/);
        expect(subastas.cancelar(s.id, "sub-vende").ok).toBe(true);
        expect(tiene("sub-vende", PIEDRA)).toBe(1);
        const otra = (dar("sub-vende", PIEDRA), nueva().subasta);
        subastas.pujar(otra.id, "sub-ana", 100, AHORA);
        expect(subastas.cancelar(otra.id, "sub-vende").motivo).toMatch(/Ya hay pujas/);
    });

    test("al cerrar, el objeto va al ganador y el dinero al vendedor menos el 5 % de comisión, que va al bote de impuestos", () => {
        const s = nueva().subasta;
        subastas.pujar(s.id, "sub-ana", 100, AHORA);
        subastas.pujar(s.id, "sub-luis", 300, AHORA);
        expect(subastas.cerrar(s.id, s.cierra - 1)).toBeNull();
        const c = subastas.cerrar(s.id, s.cierra);
        expect(c).toMatchObject({ estado: "cerrada", ganador: "sub-luis", precio_final: 300, comision: 15 });
        expect(tiene("sub-luis", PIEDRA)).toBe(1);
        expect(efectivo("sub-vende")).toBe(1285);
        expect(efectivo("sub-ana")).toBe(1000);
        expect(impuestos.boteTotal(G)).toBe(15);
        expect(subastas.cerrar(s.id, s.cierra)).toBeNull();
        expect(efectivo("sub-vende")).toBe(1285);
    });

    test("sin pujas queda desierta y el objeto vuelve al vendedor", () => {
        const s = nueva().subasta;
        expect(subastas.cerrar(s.id, s.cierra)).toMatchObject({ estado: "desierta", ganador: null });
        expect(tiene("sub-vende", PIEDRA)).toBe(1);
        expect(subastas.comisionDe(10)).toBe(1);
    });
});

describe("cron y pantallas", () => {
    test("el cron cierra las vencidas y avisa al ganador y al vendedor por DM", async () => {
        const s = nueva().subasta;
        subastas.pujar(s.id, "sub-ana", 100, AHORA);
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        expect(await envios.revisar({}, s.cierra)).toBe(1);
        expect(dm.mock.calls.map((c) => [c[1], c[2]])).toEqual([
            ["sub-ana", "subastas"],
            ["sub-vende", "subastas"],
        ]);
        expect(dm.mock.calls[1][3].content).toMatch(/Recibes \*\*95\*\*/);
        dm.mockRestore();
    });

    const interaccion = (extra) => ({ guildId: G, user: { id: "sub-luis" }, update: jest.fn(async () => {}), ...extra });

    test("pujar desde el formulario guarda la puja y avisa por DM al que queda superado", async () => {
        const s = subastas.crear({ guildId: G, userId: "sub-vende", objetoId: PIEDRA, precio: 100, incremento: 10, horas: 24 }).subasta;
        subastas.pujar(s.id, "sub-ana", 100);
        const dm = jest.spyOn(avisosDm, "enviarAviso").mockResolvedValue(true);
        const i = interaccion({ customId: `subastas_modal_puja_${s.id}`, client: {}, fields: { getTextInputValue: () => "1.000" } });
        await subastasCmd.handleModal({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/Vas ganando con \*\*1000\*\*/);
        expect(dm).toHaveBeenCalledWith(
            {},
            "sub-ana",
            "subastas",
            expect.objectContaining({ content: expect.stringMatching(/Te han superado/) }),
        );
        dm.mockRestore();
    });

    test("las pantallas respetan los límites de Discord y la ficha solo deja pujar a quien no vende", () => {
        // Dos vendedores: cada uno puede tener 5 abiertas.
        for (let i = 0; i < 6; i++) {
            const vende = i < 3 ? "sub-vende" : "sub-otro";
            dar(vende, PIEDRA);
            expect(subastas.crear({ guildId: G, userId: vende, objetoId: PIEDRA, precio: 100, incremento: 10, horas: 24 }).ok).toBe(true);
        }
        const lista = pantallaSubastas("sub-luis", "activas");
        const ids = lista.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(ids).toContain("subastas_pag_activas_1");
        expect(new Set(ids).size).toBe(ids.length);
        expect(lista.components.every((f) => f.components.length <= 5)).toBe(true);
        const id = subastas.abiertas().find((x) => x.vendedor === "sub-vende").id;
        const idsDe = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(idsDe(pantallaSubasta("sub-luis", id))).toContain(`subastas_pujar_${id}`);
        expect(idsDe(pantallaSubasta("sub-vende", id))).toEqual([`subastas_cancelar_${id}`, `subastas_ver_${id}`, "subastas_vista_mias"]);
    });
});
