// /tienda como panel único (F-EC-11, #110): /tienda abre el catálogo sin opciones, los menús de categoría y rareza
// filtran, el formulario de búsqueda filtra por nombre, y los filtros son de cada persona.
const db = require("../src/core/db");
const comando = require("../src/commands/economia/tienda");
const paneles = require("../src/paneles/tienda");

const G = "guild-tienda-panel";

db.prepare(
    "INSERT INTO objeto (id, nombre, descripcion, tipo, categoria, rareza) VALUES (60, 'Espada corta', 'afilada', 'arma', 'armas', 'raro')",
).run();
db.prepare(
    "INSERT INTO objeto (id, nombre, descripcion, tipo, categoria, rareza) VALUES (61, 'Poción roja', 'cura', 'consumible', 'pociones', 'común')",
).run();
db.prepare(
    "INSERT INTO objeto (id, nombre, descripcion, tipo, categoria, rareza) VALUES (62, 'Espada larga', 'pesada', 'arma', 'armas', 'épico')",
).run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (60, 60, 100, NULL)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (61, 61, 20, NULL)").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (62, 62, 300, NULL)").run();
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('filtro-a', 0, 1000), ('filtro-b', 0, 1000)").run();

const interaccion = (userId, extra = {}) => ({
    guildId: G,
    user: { id: userId, username: userId, tag: userId, displayName: userId },
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    guild: { id: G, roles: { cache: new Map() }, channels: { fetch: async () => null } },
    message: { interaction: { user: { id: userId } } },
    isButton: () => true,
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});

// Ids de los botones de compra de la página: el catálogo muestra un botón por objeto.
const compras = (payload) =>
    payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id)).filter((id) => id.startsWith("tienda_confirmar_"));
const menus = (payload) => payload.components.flatMap((r) => r.components.filter((c) => c.data.type === 3).map((c) => c.data.custom_id));

describe("/tienda sin opciones", () => {
    test("abre el catálogo con los menús de categoría y rareza y el botón de buscar", async () => {
        const i = interaccion("filtro-a");
        await comando.run(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.embeds[0].data.title).toBe("🛒 Tienda del Servidor");
        expect(menus(payload)).toEqual(["tienda_filtro_categoria_catalogo", "tienda_filtro_rareza_catalogo"]);
        expect(payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id))).toContain("tienda_buscar_catalogo");
    });
});

describe("filtros del catálogo", () => {
    test("el menú de categoría deja solo esa categoría; elegir 'todas' lo quita", async () => {
        const u = "filtro-a";
        const sel = interaccion(u, { customId: "tienda_filtro_categoria_catalogo", values: ["pociones"] });
        await comando.handleSelect(null, sel);
        const filtrado = sel.update.mock.calls[0][0];
        expect(compras(filtrado)).toContain("tienda_confirmar_61");
        expect(compras(filtrado)).not.toContain("tienda_confirmar_60");
        expect(compras(filtrado)).not.toContain("tienda_confirmar_62");

        const quitar = interaccion(u, { customId: "tienda_filtro_categoria_catalogo", values: [paneles.SIN_FILTRO] });
        await comando.handleSelect(null, quitar);
        expect(compras(quitar.update.mock.calls[0][0])).toEqual(expect.arrayContaining(["tienda_confirmar_60", "tienda_confirmar_61"]));
    });

    test("el formulario de búsqueda filtra por nombre, y el botón de quitarla devuelve la lista", async () => {
        const u = "filtro-a";
        const modal = interaccion(u, {
            customId: "tienda_modal_buscar_catalogo",
            fields: { getTextInputValue: () => "espada" },
            isFromMessage: () => true,
        });
        await comando.handleModal(null, modal);
        const buscado = modal.update.mock.calls[0][0];
        expect(compras(buscado)).toEqual(expect.arrayContaining(["tienda_confirmar_60", "tienda_confirmar_62"]));
        expect(compras(buscado)).not.toContain("tienda_confirmar_61");
        expect(buscado.components.flatMap((r) => r.components.map((b) => b.data.custom_id))).toContain("tienda_nobuscar_catalogo");

        const quitar = interaccion(u, { customId: "tienda_nobuscar_catalogo" });
        await comando.handleButton(null, quitar);
        expect(compras(quitar.update.mock.calls[0][0])).toEqual(expect.arrayContaining(["tienda_confirmar_60", "tienda_confirmar_61"]));
    });

    test("un filtro que no encuentra nada lo dice y deja los menús para cambiarlo", async () => {
        const u = "filtro-a";
        const modal = interaccion(u, {
            customId: "tienda_modal_buscar_catalogo",
            fields: { getTextInputValue: () => "nada así" },
            isFromMessage: () => true,
        });
        await comando.handleModal(null, modal);
        const vacio = modal.update.mock.calls[0][0];
        expect(vacio.embeds[0].data.description).toMatch(/No hay objetos con estos filtros/);
        expect(menus(vacio)).toHaveLength(2);
        expect(compras(vacio)).toEqual([]);
        await comando.handleButton(null, interaccion(u, { customId: "tienda_nobuscar_catalogo" }));
    });

    test("los filtros son de cada persona: lo que filtra una no cambia lo que ve la otra", async () => {
        const a = interaccion("filtro-a", { customId: "tienda_filtro_categoria_catalogo", values: ["pociones"] });
        await comando.handleSelect(null, a);
        const b = interaccion("filtro-b");
        await comando.run(null, b);
        expect(compras(b.reply.mock.calls[0][0])).toEqual(expect.arrayContaining(["tienda_confirmar_60", "tienda_confirmar_61"]));
    });
});

describe("filtros del inventario", () => {
    test("la búsqueda también filtra el inventario, y se mantiene al volver al catálogo", async () => {
        db.prepare(
            "INSERT INTO inventario (userId, itemId, fecha) VALUES ('filtro-b', 60, '2026-10-01'), ('filtro-b', 61, '2026-10-01')",
        ).run();
        const modal = interaccion("filtro-b", {
            customId: "tienda_modal_buscar_inventario",
            fields: { getTextInputValue: () => "poción" },
            isFromMessage: () => true,
        });
        await comando.handleModal(null, modal);
        const inv = modal.update.mock.calls[0][0];
        expect(inv.embeds[0].data.title).toBe("🎒 Tu inventario");
        expect(inv.embeds[0].data.fields.map((f) => f.name)).toEqual([expect.stringMatching(/Poción roja/)]);
    });
});
