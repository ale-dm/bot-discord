// /tienda: comprobaciones antes de cobrar y el botón de compra de principio a fin (BD en memoria).
const db = require("../src/core/db");
const tienda = require("../src/systems/tienda");
const comando = require("../src/commands/economia/tienda");

const G = "guild-tienda";
const CFG = { enabled: true, buy_cooldown_sec: 0, daily_limit: 0 };

db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo, unico) VALUES (50, 'Espada', 'afilada', 'arma', 0)").run();
db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo, unico) VALUES (51, 'Corona', 'única', 'otro', 1)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (10, 50, 200, 1)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (11, 51, 100, NULL)").run();

let n = 0;
function cliente(saldo) {
    const id = `cliente-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo) VALUES (?, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(id).saldo;

describe("comprobarCompra", () => {
    test("sin saldo no se puede", () => {
        expect(tienda.comprobarCompra(G, cliente(50), tienda.itemTienda(10), CFG)).toEqual({
            ok: false,
            mensaje: expect.stringMatching(/suficiente saldo/),
        });
    });

    test("un objeto único solo se compra una vez", () => {
        const u = cliente(1000);
        const corona = tienda.itemTienda(11);
        expect(tienda.comprobarCompra(G, u, corona, CFG).ok).toBe(true);
        expect(tienda.cobrarCompra(u, corona)).toBe(true);
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
