// Objetos de protección contra robos (F-EC-06c, issue #79): el 🔒 Candado y la 💣 Trampa que la migración 023 pone a la
// venta, comprados en la tienda de verdad, y lo que hacen en /robar (probabilidad, multa, cuándo se gastan), el mensaje
// del comando y el 🛒 Catálogo del panel.
process.env.ROBAR_COOLDOWN_SEC = "7200";
process.env.ROBAR_MIN_VICTIMA = "150";
process.env.ROBAR_PROB_EXITO = "0.65";
process.env.ROBAR_BASE_MIN = "50";
process.env.ROBAR_BASE_MAX = "150";
process.env.ROBAR_BONUS_NIVEL = "2";
process.env.ROBAR_MULTA_MIN = "30";
process.env.ROBAR_MULTA_MAX = "80";

const Database = require("better-sqlite3");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const tienda = require("../src/systems/tienda");
const { robar, efectoProteccion, proteccionesDe } = require("../src/systems/robar");
const robarComando = require("../src/commands/economia/robar");
const paneladmin = require("../src/commands/admin/paneladmin");
const { runMigrations } = require("../src/core/migrations");

const G = "g-antirrobo";
const aLaVenta = (efecto) =>
    db
        .prepare(
            "SELECT t.id AS tiendaId, o.id, o.nombre, o.tipo, o.efecto, t.precio, t.stock FROM tienda t JOIN objeto o ON o.id = t.objetoId WHERE o.efecto = ?",
        )
        .get(efecto);
const cuantos = (userId, efecto) =>
    db
        .prepare("SELECT COUNT(*) AS n FROM inventario i JOIN objeto o ON o.id = i.itemId WHERE i.userId = ? AND o.efecto = ?")
        .get(userId, efecto).n;
const comprar = (userId, efecto) => tienda.cobrarCompra(userId, G, tienda.itemTienda(aLaVenta(efecto).tiendaId));
const azar = (...valores) => {
    const spy = jest.spyOn(Math, "random");
    for (const v of valores) spy.mockReturnValueOnce(v);
};

beforeEach(() => db.prepare("DELETE FROM robos_cooldown").run());
afterEach(() => jest.restoreAllMocks());

test("la migración 023 pone a la venta el candado y la trampa (y no los repite)", () => {
    expect(aLaVenta("antirrobo:30")).toMatchObject({ nombre: "Candado", tipo: "coleccionable", precio: 150, stock: null });
    expect(aLaVenta("trampa:3")).toMatchObject({ nombre: "Trampa para ladrones", tipo: "coleccionable", precio: 100, stock: null });

    const otra = new Database(":memory:");
    runMigrations(otra);
    otra.prepare("DELETE FROM schema_migrations WHERE version = 23").run();
    runMigrations(otra);
    expect(otra.prepare("SELECT COUNT(*) AS n FROM objeto WHERE efecto IN ('antirrobo:30', 'trampa:3')").get().n).toBe(2);
    expect(otra.prepare("SELECT COUNT(*) AS n FROM tienda").get().n).toBe(2);
});

test("los efectos válidos", () => {
    expect(efectoProteccion("antirrobo:30")).toEqual({ tipo: "antirrobo", valor: 30 });
    expect(efectoProteccion("trampa:3")).toEqual({ tipo: "trampa", valor: 3 });
    expect(["antirrobo:0", "antirrobo:101", "trampa:1", "trampa:11", "monedas:5", "", null].map(efectoProteccion)).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
        null,
    ]);
});

test("🔒 con un candado, un intento que habría salido bien falla, y el candado se gasta", () => {
    dinero.pagar("v1", 1000);
    expect(comprar("v1", "antirrobo:30")).toBe(true);
    // 0,5: sin candado saldría bien (< 0,65); con él, la probabilidad es 0,35.
    azar(0.5, 0);
    const r = robar(G, "l1", "v1");
    expect(r).toMatchObject({ ok: true, exito: false, multa: 30, candado: "Candado", trampa: null });
    expect(cuantos("v1", "antirrobo:30")).toBe(0);
    // Sin candado ya, el mismo azar sale bien.
    db.prepare("DELETE FROM robos_cooldown").run();
    azar(0.5, 0);
    expect(robar(G, "l1", "v1")).toMatchObject({ ok: true, exito: true, candado: null });
});

test("🔒 el candado se gasta también si el robo sale bien igualmente", () => {
    dinero.pagar("v2", 1000);
    comprar("v2", "antirrobo:30");
    azar(0.1, 0);
    expect(robar(G, "l2", "v2")).toMatchObject({ exito: true, candado: "Candado" });
    expect(cuantos("v2", "antirrobo:30")).toBe(0);
});

test("💣 la trampa triplica la multa si el robo falla, y solo entonces se gasta", () => {
    dinero.pagar("v3", 1000);
    comprar("v3", "trampa:3");
    // Sale bien: la trampa no salta.
    azar(0, 0);
    expect(robar(G, "l3", "v3")).toMatchObject({ exito: true, trampa: null });
    expect(cuantos("v3", "trampa:3")).toBe(1);

    db.prepare("DELETE FROM robos_cooldown").run();
    const efectivo = dinero.efectivo("l3");
    azar(0.99, 0); // falla; multa base 30
    expect(robar(G, "l3", "v3")).toMatchObject({ exito: false, multa: 90, trampa: "Trampa para ladrones" });
    expect(dinero.efectivo("l3")).toBe(efectivo - 90);
    expect(cuantos("v3", "trampa:3")).toBe(0);
    expect(dinero.movimientos("l3", { tipo: "robo", limite: 1 }).filas[0]).toMatchObject({
        descripcion: "Multa por un robo fallido (Trampa para ladrones)",
        cantidad: -90,
    });
});

test("con varios, se usa el más fuerte y solo se gasta ese; a una víctima sin dinero no se le gasta nada", () => {
    const flojo = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, efecto) VALUES ('Candado flojo', 'x', 'coleccionable', 'antirrobo:10')")
        .run().lastInsertRowid;
    const fuerte = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, efecto) VALUES ('Candado fuerte', 'x', 'coleccionable', 'antirrobo:60')")
        .run().lastInsertRowid;
    const dar = db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, 'x')");
    dinero.pagar("v4", 1000);
    dar.run("v4", flojo);
    dar.run("v4", fuerte);
    expect(proteccionesDe("v4").antirrobo).toMatchObject({ nombre: "Candado fuerte", valor: 60 });
    azar(0.1, 0); // con el fuerte, la probabilidad es 0,05: falla
    expect(robar(G, "l4", "v4")).toMatchObject({ exito: false, candado: "Candado fuerte" });
    expect(proteccionesDe("v4").antirrobo).toMatchObject({ nombre: "Candado flojo" });

    dar.run("pobre", fuerte);
    dinero.cobrar("pobre", dinero.efectivo("pobre") - 100);
    expect(robar(G, "l5", "pobre")).toEqual({ ok: false, reason: "victima-pobre" });
    expect(proteccionesDe("pobre").antirrobo).toMatchObject({ nombre: "Candado fuerte" });
});

test("/robar le dice al ladrón que había un candado y que ha saltado una trampa", async () => {
    dinero.pagar("v6", 1000);
    comprar("v6", "antirrobo:30");
    comprar("v6", "trampa:3");
    azar(0.5, 0);
    const i = {
        guildId: G,
        user: { id: "l6", tag: "l6" },
        options: { getUser: () => ({ id: "v6", username: "Ana", tag: "Ana", bot: false }) },
        reply: jest.fn(async () => {}),
    };
    await robarComando.run(null, i);
    expect(i.reply.mock.calls[0][0]).toBe(
        "🔒 Ana tenía **Candado** (lo ha gastado en tu intento). 💣 ¡Ha saltado su **Trampa para ladrones**: la multa se multiplica! " +
            "🚨 Te han pillado intentando robar a Ana. Pagas una multa de **90** 🪙.",
    );
});

describe("🛒 Catálogo del panel", () => {
    const modal = (customId, campos) => ({
        guildId: G,
        guild: { id: G },
        customId,
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        fields: { getTextInputValue: (k) => campos[k] ?? "", getStringSelectValues: (k) => [campos[k] ?? ""] },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    });
    const respuesta = (i) => JSON.stringify([i.reply.mock.calls, i.update.mock.calls]);

    test("se puede crear un coleccionable de protección, con efectos dentro de sus límites", async () => {
        const ok = modal("paneladmin_cat_crear_modal", {
            nombre: "Perro guardián",
            descripcion: "Muerde",
            tipo: "coleccionable",
            extra: "antirrobo:50",
        });
        await paneladmin.handleModal(null, ok);
        expect(db.prepare("SELECT tipo, efecto FROM objeto WHERE nombre = 'Perro guardián'").get()).toEqual({
            tipo: "coleccionable",
            efecto: "antirrobo:50",
        });

        const mal = modal("paneladmin_cat_crear_modal", {
            nombre: "Trampa rota",
            descripcion: "x",
            tipo: "coleccionable",
            extra: "trampa:50",
        });
        await paneladmin.handleModal(null, mal);
        expect(respuesta(mal)).toMatch(/trampa:N` \(2-10/);
        expect(db.prepare("SELECT COUNT(*) AS n FROM objeto WHERE nombre = 'Trampa rota'").get().n).toBe(0);
    });
});
