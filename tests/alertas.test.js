// Alertas por DM a los admins: errores nuevos, Odds API con pocos créditos, Gemini sin cuota. Sin Discord ni red.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.ODDS_API_KEY = "clave-de-prueba";

const mockGenerate = jest.fn();
jest.mock("@google/genai", () => ({
    ...jest.requireActual("@google/genai"),
    GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerate } })),
}));

const { createLogger } = require("../src/core/logger");
const guildSettings = require("../src/systems/guildSettings");
const alertas = require("../src/systems/alertas");
const oddsApi = require("../src/services/oddsApi");
const { generateContentWithTimeout } = require("../src/services/geminiClient");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-alertas";
const DUENO = "999999999999999999";
const log = createLogger("Prueba");

function clienteFalso() {
    const dms = [];
    return {
        dms,
        guilds: { cache: new Map([[G, { id: G, name: "Servidor", ownerId: DUENO }]]) },
        users: {
            fetch: async (id) => ({ id, send: async (payload) => dms.push({ id, titulo: payload.embeds[0].data.title, payload }) }),
        },
    };
}
// Los DMs se mandan sin esperar (el log no espera a nadie): se deja correr la cola de promesas.
const esperar = () => new Promise((r) => setImmediate(r));

alertas.escucharErrores();
beforeEach(() => {
    alertas._reiniciar();
    guildSettings.setManySettings(G, { "alertas.enabled": true, "alertas.admin_ids": "" });
});

test("los errores de antes de conectar se guardan y se mandan al conectar, al dueño si no hay nadie puesto", async () => {
    log.error("La base de datos no responde");
    await esperar();
    const client = clienteFalso();
    await alertas.iniciar(client);
    expect(client.dms).toEqual([expect.objectContaining({ id: DUENO, titulo: "❌ Error nuevo en el bot" })]);
    expect(client.dms[0].payload.embeds[0].data.description).toMatch(/\[Prueba\] La base de datos no responde/);
});

test("el mismo error (aunque cambien los números) no se repite; uno distinto sí", async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    log.error("La partida 123 falló");
    log.error("La partida 456 falló");
    log.error("Otra cosa distinta");
    await esperar();
    expect(client.dms.map((d) => d.payload.embeds[0].data.description.split("\n")[0])).toEqual([
        "[Prueba] La partida 123 falló",
        "[Prueba] Otra cosa distinta",
    ]);
});

test("un backup fallido sale con su propio título", async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    createLogger("Backups").error("La copia de seguridad banco-2026-10-02.db falló:", new Error("disco lleno"));
    await esperar();
    expect(client.dms[0].titulo).toBe("💾 La copia de seguridad ha fallado");
});

test("con admins puestos van a ellos; desactivadas no van a nadie", async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    guildSettings.setSetting(G, "alertas.admin_ids", "111111111111111111,222222222222222222");
    expect(await alertas.alertar({ clave: "a", titulo: "Uno", detalle: "x" })).toBe(2);
    expect(client.dms.map((d) => d.id)).toEqual(["111111111111111111", "222222222222222222"]);

    guildSettings.setSetting(G, "alertas.enabled", false);
    expect(await alertas.alertar({ clave: "b", titulo: "Dos", detalle: "x" })).toBe(0);
    expect(client.dms).toHaveLength(2);
});

test(`como mucho ${alertas.MAX_POR_HORA} a la hora (la prueba del panel no cuenta)`, async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    for (let n = 0; n < alertas.MAX_POR_HORA + 3; n++) await alertas.alertar({ clave: `k${n}`, titulo: `T${n}`, detalle: "x" });
    expect(client.dms).toHaveLength(alertas.MAX_POR_HORA);
    expect(await alertas.probar("admin")).toBe(1);
});

test("la Odds API con menos de 50 créditos avisa una vez (y el panel enseña los créditos)", async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    global.fetch = jest.fn(async () => ({ ok: true, headers: new Map([["x-requests-remaining", "30"]]), json: async () => [] }));
    await oddsApi.obtenerResultados("laliga");
    await oddsApi.obtenerResultados("premier");
    await esperar();
    expect(client.dms.map((d) => d.titulo)).toEqual(["⚽ Quedan pocos créditos de la Odds API"]);
    expect(oddsApi.creditosRestantes().restantes).toBe(30);

    const i = {
        customId: "paneladmin_sis_home",
        guildId: G,
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        client: { slashCommands: new Map(), guilds: { cache: new Map() } },
        update: jest.fn(async () => {}),
    };
    await paneladmin.handleButton(null, i);
    const campos = Object.fromEntries(i.update.mock.calls[0][0].embeds[0].data.fields.map((f) => [f.name, f.value]));
    expect(campos["Odds API"]).toMatch(/\*\*30\*\* créditos restantes.*⚠️/);
    expect(campos["Alertas por DM"]).toMatch(/activas · a el dueño del servidor/);
});

test("Gemini sin cuota avisa", async () => {
    const client = clienteFalso();
    await alertas.iniciar(client);
    mockGenerate.mockRejectedValueOnce(Object.assign(new Error("RESOURCE_EXHAUSTED: quota exceeded"), { status: 429 }));
    await expect(generateContentWithTimeout({ model: "gemini-x", contents: [] }, 0, "Duende")).rejects.toThrow(/quota/);
    await esperar();
    expect(client.dms.map((d) => d.titulo)).toEqual(["🤖 Gemini sin cuota"]);
});

describe("/paneladmin → 🩺 Sistema → 🔔 Alertas", () => {
    const interaccion = (extra) => ({
        guildId: G,
        guild: { id: G, ownerId: DUENO },
        user: { id: "admin", tag: "admin", username: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        ...extra,
    });

    test("la pantalla dice a quién van; el formulario guarda IDs válidos y rechaza los que no lo son", async () => {
        const home = interaccion({ customId: "paneladmin_sis_alertas" });
        await paneladmin.handleButton(null, home);
        const campos = Object.fromEntries(home.update.mock.calls[0][0].embeds[0].data.fields.map((f) => [f.name, f.value]));
        expect(campos["A quién"]).toBe(`el dueño del servidor (<@${DUENO}>)`);

        const formulario = (campos) =>
            interaccion({
                customId: "paneladmin_sis_alertas_modal",
                fields: { getTextInputValue: (k) => campos[k] ?? "", getRadioGroup: (k) => campos[k] ?? "" },
            });
        const mal = formulario({ activas: "1", ids: "123, pepito" });
        await paneladmin.handleModal(null, mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/no son IDs de Discord: 123, pepito/);

        const bien = formulario({ activas: "1", ids: "111111111111111111 , 222222222222222222" });
        await paneladmin.handleModal(null, bien);
        expect(guildSettings.getSettings(G).alertas.admin_ids).toBe("111111111111111111,222222222222222222");
        expect(bien.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Alertas actualizadas/);
    });

    test("📨 Probar manda una alerta y dice a cuántos ha llegado", async () => {
        const client = clienteFalso();
        await alertas.iniciar(client);
        const i = interaccion({ customId: "paneladmin_sis_alertas_probar" });
        await paneladmin.handleButton(null, i);
        expect(client.dms.map((d) => d.titulo)).toEqual(["🔔 Alerta de prueba"]);
        expect(i.editReply.mock.calls[0][0].content).toMatch(/enviada a 1 de 1/);
    });
});
