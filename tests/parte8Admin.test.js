// Parte 8 del plan de paneles: /paneladmin con las secciones ⚽ Apuestas, 🛒 Catálogo y 🩺 Sistema, que sustituyen a
// /pagarapuestas, /objeto, los subcomandos de admin de /tienda, /diagnostico, /ttcl-diagnostico y /panel.
jest.mock("../src/systems/apuestas/liquidacion", () => ({
    ...jest.requireActual("../src/systems/apuestas/liquidacion"),
    liquidarApuestas: jest.fn(async () => ({
        pagadas: 2,
        fallidas: 1,
        total: 3,
        partidosProcesados: { laliga: 1 },
        quinielasCerradas: 0,
        premiosQuiniela: 0,
        caducados: 0,
        reembolsos: 0,
        pagos: [],
    })),
}));
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const { getLogStats, setLogLevel } = require("../src/core/logger");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-p8";
const interaccion = (extra = {}) => ({
    guildId: G,
    guild: { id: G },
    user: { id: "admin", tag: "admin", username: "admin" },
    member: { permissions: { has: () => true } },
    client: {
        slashCommands: new Map(),
        guilds: { cache: new Map() },
        user: { displayAvatarURL: () => null },
        users: { fetch: async () => null },
    },
    isFromMessage: () => true,
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    deferReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
    ...extra,
});
const boton = async (customId, extra) => {
    const i = interaccion({ customId, ...extra });
    await paneladmin.handleButton(i.client, i);
    return i;
};
const formulario = async (customId, campos) => {
    const i = interaccion({ customId, fields: { getTextInputValue: (k) => campos[k] ?? "" } });
    await paneladmin.handleModal(i.client, i);
    return i;
};
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));

test("la pantalla principal tiene las tres secciones nuevas", async () => {
    const i = interaccion();
    await paneladmin.run(i.client, i);
    expect(ids(i.reply.mock.calls[0][0])).toEqual(
        expect.arrayContaining(["paneladmin_apu_home", "paneladmin_cat_home", "paneladmin_sis_home"]),
    );
});

describe("🛒 Catálogo", () => {
    test("crear, editar, poner a la venta, quitar y eliminar un objeto", async () => {
        const crear = await formulario("paneladmin_cat_crear_modal", {
            nombre: "Poción",
            descripcion: "cura",
            tipo: "consumible",
            extra: "monedas:50",
        });
        expect(crear.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Poción\*\* creado/);
        const obj = db.prepare("SELECT * FROM objeto WHERE nombre = 'Poción'").get();
        expect(obj).toMatchObject({ tipo: "consumible", efecto: "monedas:50" });

        await formulario("paneladmin_cat_editar_modal", { id: String(obj.id), campo: "rareza", valor: "épico" });
        expect(db.prepare("SELECT rareza FROM objeto WHERE id = ?").get(obj.id).rareza).toBe("épico");

        await formulario("paneladmin_cat_vender_modal", { id: String(obj.id), precio: "80", stock: "" });
        expect(db.prepare("SELECT precio, stock FROM tienda WHERE objetoId = ?").get(obj.id)).toEqual({ precio: 80, stock: null });
        await formulario("paneladmin_cat_vender_modal", { id: String(obj.id), precio: "90", stock: "3" });
        expect(db.prepare("SELECT precio, stock FROM tienda WHERE objetoId = ?").all(obj.id)).toEqual([{ precio: 90, stock: 3 }]);

        const noSePuede = await formulario("paneladmin_cat_eliminar_modal", { id: String(obj.id) });
        expect(noSePuede.reply.mock.calls[0][0].content).toMatch(/está a la venta/);

        await formulario("paneladmin_cat_quitar_modal", { id: String(obj.id) });
        await formulario("paneladmin_cat_eliminar_modal", { id: String(obj.id) });
        expect(db.prepare("SELECT 1 FROM objeto WHERE id = ?").get(obj.id)).toBeUndefined();
    });

    test("los datos inválidos se rechazan sin tocar nada", async () => {
        const tipo = await formulario("paneladmin_cat_crear_modal", { nombre: "X", descripcion: "x", tipo: "arma" });
        expect(tipo.reply.mock.calls[0][0].content).toMatch(/El tipo tiene que ser/);
        const efecto = await formulario("paneladmin_cat_crear_modal", {
            nombre: "X",
            descripcion: "x",
            tipo: "consumible",
            extra: "vida:3",
        });
        expect(efecto.reply.mock.calls[0][0].content).toMatch(/monedas:N/);
        expect(db.prepare("SELECT COUNT(*) AS n FROM objeto WHERE nombre = 'X'").get().n).toBe(0);
    });
});

describe("⚽ Apuestas", () => {
    test("la sección enseña lo pendiente y liquidar ahora da el resumen", async () => {
        const home = await boton("paneladmin_apu_home");
        expect(home.update.mock.calls[0][0].embeds[0].data.title).toBe("⚽ Apuestas");
        expect(ids(home.update.mock.calls[0][0])).toContain("paneladmin_apu_quiniela_laliga");

        const liquidar = await boton("paneladmin_apu_liquidar");
        expect(liquidar.deferReply).toHaveBeenCalled();
        expect(liquidar.editReply.mock.calls[0][0].embeds[0].data.description).toMatch(/Apuestas ganadoras:\*\* 2/);
    });
});

describe("🩺 Sistema", () => {
    test("diagnóstico, TTCL y nivel de log", async () => {
        const home = await boton("paneladmin_sis_home");
        expect(home.update.mock.calls[0][0].embeds[0].data.title).toBe("🩺 Diagnóstico del bot");
        const ttcl = await boton("paneladmin_sis_ttcl");
        expect(ttcl.update.mock.calls[0][0].embeds[0].data.title).toBe("💎 Diagnóstico TTCL");

        const antes = getLogStats().level;
        const select = interaccion({ customId: "paneladmin_sis_log", values: ["warn"] });
        await paneladmin.handleStringSelect(select.client, select);
        expect(getLogStats().level).toBe("warn");
        setLogLevel(antes);
    });
});

test("sin ser admin no se puede usar", async () => {
    const i = await boton("paneladmin_cat_home", { member: { permissions: { has: () => false } } });
    expect(i.update).not.toHaveBeenCalled();
});

test("quedan 16 comandos, sin los de admin sueltos", () => {
    const nombres = [];
    const walk = (d) =>
        fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js") && require(p).data) nombres.push(require(p).data.name);
        });
    walk(path.join(__dirname, "../src/commands"));
    for (const viejo of ["panel", "pagarapuestas", "objeto", "diagnostico", "ttcl-diagnostico"]) expect(nombres).not.toContain(viejo);
    expect(nombres.sort()).toEqual(
        [
            "ayuda",
            "bola8",
            "cine",
            "conversación",
            "cripto",
            "duende",
            "escuchar",
            "ia",
            "imagen",
            "javier",
            "juegos",
            "paneladmin",
            "perfil",
            "ping",
            "recomendar",
            "robar",
            "tienda",
            "trabajar",
            "tts",
        ].sort(),
    );
});
