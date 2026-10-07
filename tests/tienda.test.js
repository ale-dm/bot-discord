// /tienda: comprobaciones antes de cobrar y el botón de compra de principio a fin (BD en memoria).
const db = require("../src/core/db");
const tienda = require("../src/systems/tienda");
const comando = require("../src/commands/economia/tienda");
const impuestos = require("../src/systems/impuestos");

const G = "guild-tienda";
const CFG = { enabled: true, buy_cooldown_sec: 0, daily_limit: 0 };

db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo, unico) VALUES (50, 'Espada', 'afilada', 'arma', 0)").run();
db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo, unico) VALUES (51, 'Corona', 'única', 'otro', 1)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (10, 50, 200, 1)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (11, 51, 100, NULL)").run();

let n = 0;
function cliente(saldo) {
    const id = `cliente-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT enMano AS saldo FROM banco WHERE userId = ?").get(id).saldo;

describe("comprobarCompra", () => {
    test("sin saldo no se puede", () => {
        expect(tienda.comprobarCompra(G, cliente(50), tienda.itemTienda(10), CFG)).toEqual({
            ok: false,
            mensaje: expect.stringMatching(/No te llega el efectivo/),
        });
    });

    test("un objeto único solo se compra una vez", () => {
        const u = cliente(1000);
        const corona = tienda.itemTienda(11);
        expect(tienda.comprobarCompra(G, u, corona, CFG).ok).toBe(true);
        expect(tienda.cobrarCompra(u, G, corona)).toBe(true);
        expect(tienda.comprobarCompra(G, u, corona, CFG).mensaje).toMatch(/una vez/);
    });

    test("los filtros de la tienda", () => {
        expect(tienda.itemsTienda({ busqueda: "esp" }).map((i) => i.nombre)).toEqual(["Espada"]);
        expect(tienda.itemsTienda({ categoria: "nada" })).toEqual([]);
    });
});

test("el botón de compra cobra, entrega y enseña el resultado; sin stock ya no deja", async () => {
    const i = (userId, customId) => ({
        customId,
        guildId: G,
        user: { id: userId, tag: userId, displayName: userId },
        member: { permissions: { has: () => false }, roles: { cache: new Map() } },
        guild: { id: G, roles: { cache: new Map() }, channels: { fetch: async () => null } },
        isButton: () => true,
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    });
    const u = cliente(1000);
    const compra = i(u, "tienda_comprar_10");
    await comando.handleButton(null, compra);
    expect(compra.update.mock.calls[0][0].embeds[0].data.title).toBe("✅ ¡Compra realizada!");
    expect(saldo(u)).toBe(800);

    const otro = cliente(1000);
    const agotado = i(otro, "tienda_comprar_10");
    await comando.handleButton(null, agotado);
    expect(agotado.update.mock.calls[0][0].content).toMatch(/agotado/);
    expect(saldo(otro)).toBe(1000);
});

describe("impuesto de compra (F-EC-06a)", () => {
    const GC = "guild-tienda-impuesto";
    afterEach(() => {
        db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ?").run(GC);
        db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(GC);
    });

    test("con una regla de compra activa, se cobra precio + impuesto y va al bote", () => {
        impuestos.anadirRegla(GC, { base: "compra", porcentaje: 10, destino: "bote" });
        const u = cliente(1000);
        const corona = tienda.itemTienda(11);

        expect(tienda.cobrarCompra(u, GC, corona)).toBe(true); // precio 100 + 10 de impuesto
        expect(saldo(u)).toBe(1000 - 110);
        expect(impuestos.boteTotal(GC)).toBe(10);
    });

    test("comprobarCompra tiene en cuenta el impuesto al mirar si llega el saldo", () => {
        impuestos.anadirRegla(GC, { base: "compra", porcentaje: 10, destino: "bote" });
        const corona = tienda.itemTienda(11); // precio 100, con impuesto hacen falta 110 (stock ilimitado)
        expect(tienda.comprobarCompra(GC, cliente(105), corona, CFG).ok).toBe(false);
        expect(tienda.comprobarCompra(GC, cliente(110), corona, CFG).ok).toBe(true);
    });
});
