// Los botones mercado_* de /tienda (src/perfil/tiendaExtras): gestionar, regalar con confirmación, vender a la tienda, el mercado,
// la lista de deseos y canjear un código; y el botón 📤 Exportar de Movimientos.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/mercado");
const codigos = require("../src/systems/codigos");
const guildSettings = require("../src/systems/guildSettings");
const extras = require("../src/perfil/tiendaExtras");
const dineroBotones = require("../src/perfil/dinero");

const G = "g-f7-ui";
const cuenta = (id, efectivo = 1000) => {
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
};
cuenta("ana");
cuenta("beto");
db.prepare("INSERT INTO objeto (id, nombre, descripcion, tipo) VALUES (9001, 'Pluma UI', 'una pluma', 'coleccionable')").run();
db.prepare("INSERT INTO tienda (id, objetoId, precio, stock) VALUES (9001, 9001, 200, NULL)").run();
guildSettings.setSetting(G, "tienda.recompra_pct", 50);
const dar = (u) => db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, 9001, '2026-10-01')").run(u);
const tiene = (u) => db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ? AND itemId = 9001").get(u).n;

const interaccion = (userId, customId, extra = {}) => ({
    guildId: G,
    customId,
    user: { id: userId, username: userId, tag: userId },
    guild: { id: G, members: { fetch: async (id) => ({ id, user: { id, username: id, bot: false } }) } },
    message: { interaction: { user: { id: userId } } },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    ...extra,
});
const ultimo = (fn) => fn.mock.calls.at(-1)[0];
const ids = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data.custom_id));

test("gestionar → elegir objeto → acciones, y solo quien abrió la tienda usa los botones", async () => {
    dar("ana");
    const i = interaccion("ana", "mercado_gestionar");
    await extras.handleButton(null, i);
    expect(ids(ultimo(i.update))).toContain("mercado_gestion_sel");
    const sel = interaccion("ana", "mercado_gestion_sel", { values: ["9001"] });
    await extras.handleSelect(null, sel);
    expect(ids(ultimo(sel.update))).toEqual(expect.arrayContaining(["mercado_regalar_9001", "mercado_vender_9001", "mercado_poner_9001"]));
    const ajeno = interaccion("beto", "mercado_gestionar", { message: { interaction: { user: { id: "ana" } } } });
    await extras.handleButton(null, ajeno);
    expect(ajeno.update).not.toHaveBeenCalled();
    expect(ultimo(ajeno.reply).content).toMatch(/Solo quien abrió/);
});

test("regalar: elegir a quién, confirmar y el objeto cambia de dueño; a un bot o a uno mismo, no", async () => {
    const elegir = interaccion("ana", "mercado_regalo_a_9001", { users: { first: () => ({ id: "beto", bot: false }) }, values: ["beto"] });
    await extras.handleUserSelect(null, elegir);
    expect(ids(ultimo(elegir.update))).toContain("mercado_regalo_ok_9001_beto");
    const bot = interaccion("ana", "mercado_regalo_a_9001", { users: { first: () => ({ id: "robot", bot: true }) }, values: ["robot"] });
    await extras.handleUserSelect(null, bot);
    expect(ultimo(bot.reply).content).toMatch(/bot/);
    const yo = interaccion("ana", "mercado_regalo_a_9001", { users: { first: () => ({ id: "ana", bot: false }) }, values: ["ana"] });
    await extras.handleUserSelect(null, yo);
    expect(ultimo(yo.reply).content).toMatch(/ti mismo/);

    const ok = interaccion("ana", "mercado_regalo_ok_9001_beto");
    await extras.handleButton(null, ok);
    expect(ultimo(ok.update).embeds[0].data.description).toMatch(/Has regalado/);
    expect([tiene("ana"), tiene("beto")]).toEqual([0, 1]);

    const fuera = interaccion("beto", "mercado_regalo_ok_9001_nadie", {
        guild: {
            id: G,
            members: {
                fetch: async () => {
                    throw new Error("no está");
                },
            },
        },
    });
    await extras.handleButton(null, fuera);
    expect(tiene("beto")).toBe(1);
    expect(ultimo(fuera.update).embeds[0].data.description).toMatch(/no está en el servidor/);
});

test("vender a la tienda con confirmación y poner en el mercado con el formulario de precio", async () => {
    const pedir = interaccion("beto", "mercado_vender_9001");
    await extras.handleButton(null, pedir);
    expect(ids(ultimo(pedir.update))).toContain("mercado_vender_ok_9001");
    const ok = interaccion("beto", "mercado_vender_ok_9001");
    await extras.handleButton(null, ok);
    expect(dinero.efectivo("beto")).toBe(1100);
    expect(tiene("beto")).toBe(0);

    dar("beto");
    const modal = interaccion("beto", "mercado_poner_9001");
    await extras.handleButton(null, modal);
    expect(ultimo(modal.showModal).data.custom_id).toBe("mercado_modal_precio_9001");
    const guardar = interaccion("beto", "mercado_modal_precio_9001", { fields: { getTextInputValue: () => "300" } });
    await extras.handleModal(null, guardar);
    expect(ultimo(guardar.reply).embeds[0].data.description).toMatch(/a la venta por \*\*300\*\*/);
    expect(mercado.listar({ vendedor: "beto" }).filas).toHaveLength(1);
});

test("mercado: ver, comprar con el botón y retirar desde mis ofertas", async () => {
    const ver = interaccion("ana", "mercado_ver_1");
    await extras.handleButton(null, ver);
    const oferta = mercado.listar({ vendedor: "beto" }).filas[0];
    expect(ids(ultimo(ver.update))).toContain(`mercado_comprar_${oferta.id}`);
    const comprar = interaccion("ana", `mercado_comprar_${oferta.id}`);
    await extras.handleButton(null, comprar);
    expect(ultimo(comprar.update).embeds[0].data.description).toMatch(/Has comprado/);
    expect([dinero.efectivo("ana"), dinero.efectivo("beto")]).toEqual([700, 1400]);
    expect(tiene("ana")).toBe(1);

    dar("beto");
    const nueva = mercado.poner("beto", 9001, 50).oferta;
    const mias = interaccion("beto", "mercado_mias");
    await extras.handleButton(null, mias);
    expect(ids(ultimo(mias.update))).toContain("mercado_retirar_sel");
    const retirar = interaccion("beto", "mercado_retirar_sel", { values: [String(nueva.id)] });
    await extras.handleSelect(null, retirar);
    expect(tiene("beto")).toBe(1);
});

test("deseos: seguir desde la confirmación y dejar de seguir desde la lista", async () => {
    const seguir = interaccion("ana", "mercado_deseo_9001");
    await extras.handleButton(null, seguir);
    expect(ultimo(seguir.update).components[0].components.map((c) => c.data.label)).toContain("⭐ Siguiendo (quitar)");
    const lista = interaccion("ana", "mercado_deseos");
    await extras.handleButton(null, lista);
    expect(ultimo(lista.update).embeds[0].data.description).toContain("Pluma UI");
    const quitar = interaccion("ana", "mercado_deseo_quitar_sel", { values: ["9001"] });
    await extras.handleSelect(null, quitar);
    expect(ultimo(quitar.update).embeds[0].data.description).toMatch(/No sigues ningún/);
});

test("canjear: el botón abre el formulario y el formulario canjea el código", async () => {
    codigos.crear({ codigo: "UIBONUS", monedas: 77, usosMax: 1 });
    const abrir = interaccion("ana", "mercado_canjear");
    await extras.handleButton(null, abrir);
    expect(ultimo(abrir.showModal).data.custom_id).toBe("mercado_modal_canjear");
    const antes = dinero.efectivo("ana");
    const canje = interaccion("ana", "mercado_modal_canjear", { fields: { getTextInputValue: () => "uibonus" } });
    await extras.handleModal(null, canje);
    expect(ultimo(canje.reply).content).toMatch(/canjeado/);
    expect(dinero.efectivo("ana")).toBe(antes + 77);
});

test("📤 Exportar: responde en privado con un CSV adjunto", async () => {
    dinero.apuntar("ana", "tienda", "Compra de prueba", -5);
    const i = interaccion("ana", "dinero_exportar_todo");
    await dineroBotones.handleButton(null, i);
    const r = ultimo(i.reply);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].name).toBe("movimientos.csv");
    expect(r.flags).toBeTruthy();
    expect(r.content).toMatch(/movimientos/);
});
