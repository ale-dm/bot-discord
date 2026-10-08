// Parte 7 del plan de paneles: /tienda con pestañas (🛒 Catálogo · 🎒 Inventario · 🧾 Mis compras), el
// inventario con Usar dentro, y botones para ir al inventario o usar lo comprado. Sustituye a /inventario y /usar.
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const comando = require("../src/commands/economia/tienda");

const G = "guild-p7";
db.prepare(
    "INSERT INTO objeto (id, nombre, descripcion, tipo, efecto) VALUES (70, 'Saco de monedas', 'da 300', 'consumible', 'monedas:300')",
).run();
db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo) VALUES (71, 'Piedra bonita', 'no hace nada', 'otro')").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (20, 70, 100, NULL)").run();
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('comprador', 0, 1000)").run();
db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES ('comprador', 71, '2026-09-01')").run();

const interaccion = (extra = {}) => ({
    guildId: G,
    user: { id: "comprador", username: "comprador", tag: "comprador", displayName: "comprador" },
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    guild: { id: G, roles: { cache: new Map() }, channels: { fetch: async () => null } },
    message: { interaction: { user: { id: "comprador" } } },
    isButton: () => true,
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    ...extra,
});
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
const boton = async (customId) => {
    const i = interaccion({ customId });
    await comando.handleButton(null, i);
    return i.update.mock.calls[0]?.[0] || i.reply.mock.calls[0]?.[0];
};

test("comprar un consumible: botones para verlo en el inventario o usarlo ya, y usarlo aplica su efecto", async () => {
    const compra = await boton("tienda_comprar_20");
    expect(compra.embeds[0].data.title).toBe("✅ ¡Compra realizada!");
    expect(ids(compra)).toEqual(["tienda_volver_1", "tienda_inv_1", "tienda_usar_70_1"]);
    expect(dinero.efectivo("comprador")).toBe(900);

    const usado = await boton("tienda_usar_70_1");
    expect(usado.embeds[0].data.title).toBe("🎒 Tu inventario");
    expect(usado.embeds[0].data.description).toMatch(/Saco de monedas/);
    expect(usado.embeds[0].data.description).toMatch(/300 monedas/);
    expect(dinero.efectivo("comprador")).toBe(900 + 300 - Math.floor(300 * 0.05)); // 5% de impuesto por defecto
    // Se ha gastado: ya solo queda la piedra, que no se puede usar (sin botón de Usar).
    expect(usado.embeds[0].data.fields.map((f) => f.name)).toEqual([expect.stringMatching(/Piedra bonita/)]);
    expect(ids(usado).some((id) => id.startsWith("tienda_usar_"))).toBe(false);
});

test("las tres pestañas en todas las pantallas, y /tienda abre el catálogo con ellas", async () => {
    const esperadas = ["tienda_volver_1", "tienda_inv_1_tab", "historial_ver_1"];
    const inv = interaccion();
    await comando.run(null, inv);
    const payload = inv.reply.mock.calls[0][0];
    expect(payload.components.at(-1).components.map((b) => b.data.custom_id)).toEqual(esperadas);
    for (const id of ["tienda_volver_1", "historial_ver_1"]) {
        const p = await boton(id);
        expect(p.components.at(-1).components.map((b) => b.data.custom_id)).toEqual(esperadas);
        const lista = ids(p);
        expect(lista.filter((x, n) => lista.indexOf(x) !== n)).toEqual([]);
    }
});

// Con más de una página de inventario, ⬅️ Anterior de la página 2 era igual que la pestaña 🎒 Inventario y Discord
// rechazaba el mensaje (COMPONENT_CUSTOM_ID_DUPLICATED).
test("un inventario de varias páginas: ninguna página repite un customId, y la pestaña sigue abriéndolo", async () => {
    for (let n = 0; n < 7; n++) {
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES ('coleccionista', ?, '2026-09-02')").run(n % 2 ? 70 : 71);
        db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo) VALUES (?, ?, 'x', 'otro')").run(80 + n, `Cosa ${n}`);
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES ('coleccionista', ?, '2026-09-02')").run(80 + n);
    }
    const de = (customId) =>
        interaccion({
            customId,
            user: { id: "coleccionista", username: "c", tag: "c" },
            message: { interaction: { user: { id: "coleccionista" } } },
        });
    for (const id of ["tienda_inv_1_tab", "tienda_inv_2", "tienda_inv_1", "tienda_inv_3"]) {
        const i = de(id);
        await comando.handleButton(null, i);
        const p = i.update.mock.calls[0][0];
        expect(p.embeds[0].data.title).toBe("🎒 Tu inventario");
        const lista = ids(p);
        expect(lista.filter((x, n) => lista.indexOf(x) !== n)).toEqual([]);
    }
});

test("los botones de mensajes de /inventario llevan a la pestaña Inventario", async () => {
    const p = await boton("inv_next_0");
    expect(p.embeds[0].data.title).toBe("🎒 Tu inventario");
});

test("solo quien abrió la tienda usa sus botones", async () => {
    const i = interaccion({ customId: "tienda_inv_1", message: { interaction: { user: { id: "otro" } } } });
    await comando.handleButton(null, i);
    expect(i.update).not.toHaveBeenCalled();
});

test("/inventario y /usar ya no son comandos", () => {
    const nombres = [];
    const walk = (d) =>
        fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js") && require(p).data) nombres.push(require(p).data.name);
        });
    walk(path.join(__dirname, "../src/commands"));
    expect(nombres).toContain("tienda");
    expect(nombres).not.toContain("inventario");
    expect(nombres).not.toContain("usar");
});
