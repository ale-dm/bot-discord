// Tono del Duende según la hora o el canal (F-DU-02, issue #13): más borde de madrugada (hora de Madrid) y más formal en
// los canales elegidos, encima de la personalidad. Con /duende de verdad y Gemini simulado (se mira el prompt que le
// llega), y el panel.
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-tono-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.DUENDE_GIF_PROB = "0";

const mockPeticiones = [];
jest.mock("../src/services/geminiClient", () => ({
    generateContentWithTimeout: jest.fn(async (params) => {
        mockPeticiones.push(JSON.stringify(params.contents));
        return {
            text: "Vale.",
            functionCalls: undefined,
            candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "Vale." }] } }],
        };
    }),
}));
const guildSettings = require("../src/systems/guildSettings");
const { ajusteDeTono, dentroDeHoras } = require("../src/systems/duende/tono");
const duende = require("../src/commands/duende/duende");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "g-tono";
const FORMAL = "111111111111111111";
// 15 de octubre de 2026: 03:30 y 12:00 en Madrid.
const MADRUGADA = Date.UTC(2026, 9, 15, 1, 30);
const MEDIODIA = Date.UTC(2026, 9, 15, 10);

afterEach(() => jest.restoreAllMocks());

test("las horas, también pasando la medianoche", () => {
    expect([23, 0, 6, 7].map((h) => dentroDeHoras(h, 0, 7))).toEqual([false, true, true, false]);
    expect([22, 23, 0, 4, 5].map((h) => dentroDeHoras(h, 23, 5))).toEqual([false, true, true, true, false]);
});

test("viene desactivado: sin nada configurado, el tono no cambia", () => {
    expect(ajusteDeTono(G, FORMAL, MADRUGADA)).toBe("");
    expect(ajusteDeTono(null, FORMAL, MADRUGADA)).toBe("");
});

test("🌙 de madrugada más borde y 👔 en los canales formales más educado; los dos a la vez si toca", () => {
    guildSettings.setManySettings(G, { "duende.madrugada_activa": 1, "duende.canales_formales": `${FORMAL},222222222222222222` });
    expect(ajusteDeTono(G, "otro", MADRUGADA)).toMatch(/^Es de madrugada en España \(son las 03:30\): estás más borde/);
    expect(ajusteDeTono(G, "otro", MEDIODIA)).toBe("");
    expect(ajusteDeTono(G, FORMAL, MEDIODIA)).toMatch(/^En este canal hablas de forma más formal y educada/);
    expect(ajusteDeTono(G, FORMAL, MADRUGADA)).toMatch(/madrugada[\s\S]*más formal/);
});

describe("le llega a Gemini con el resto de instrucciones", () => {
    const hablar = async (canal) => {
        mockPeticiones.length = 0;
        const enviados = [];
        await duende.hablar(null, {
            id: `m-${Math.random()}`,
            user: { id: "u1", username: "alex" },
            guildId: G,
            member: { permissions: { has: () => false } },
            channel: { id: canal, send: async (c) => enviados.push(c) },
            deferReply: async () => {},
            editReply: async (p) => enviados.push(typeof p === "string" ? p : p.content),
            followUp: async (p) => enviados.push(typeof p === "string" ? p : p.content),
            options: { getSubcommand: () => "talk", getString: (n) => (n === "texto" ? "hola" : null), getUser: () => null },
        });
        expect(enviados).toContain("Vale.");
        return mockPeticiones[0];
    };

    test("en un canal formal, a mediodía", async () => {
        jest.spyOn(Date, "now").mockReturnValue(MEDIODIA);
        const prompt = await hablar(FORMAL);
        expect(prompt).toMatch(/En este canal hablas de forma más formal y educada/);
        expect(prompt).not.toMatch(/Es de madrugada/);
    });

    test("en otro canal, de madrugada", async () => {
        jest.spyOn(Date, "now").mockReturnValue(MADRUGADA);
        const prompt = await hablar("canal-normal");
        expect(prompt).toMatch(/Es de madrugada en España \(son las 03:30\)/);
        expect(prompt).not.toMatch(/más formal/);
    });
});

describe("/paneladmin → ⚙️ Config Global → 🤖 Duende → 🕐 Tono", () => {
    const P = "g-panel-tono";
    const interaccion = (extra) => ({
        guildId: P,
        guild: { id: P },
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const formulario = (campos) =>
        interaccion({
            customId: "paneladmin_cfg_duende_tono_modal",
            fields: { getTextInputValue: (k) => campos[k] ?? "", getRadioGroup: (k) => campos[k] ?? "" },
        });
    const tono = (payload) => payload.embeds[0].data.fields.find((f) => f.name === "🕐 Tono").value;

    test("la pantalla, el formulario y la validación", async () => {
        const panel = interaccion({ customId: "paneladmin_cfg_duende" });
        await paneladmin.handleButton(null, panel);
        expect(tono(panel.update.mock.calls[0][0])).toBe("🌙 De madrugada: igual que siempre\n👔 Ningún canal formal");

        const boton = interaccion({ customId: "paneladmin_cfg_duende_tono" });
        await paneladmin.handleButton(null, boton);
        expect(
            boton.showModal.mock.calls[0][0]
                .toJSON()
                .components.map((r) => (r.component ? r.component.options.find((o) => o.default)?.value : r.components[0].value)),
        ).toEqual(["0", "0", "7", ""]);

        for (const [campos, error] of [
            [{ activa: "1", desde: "2", hasta: "2", formales: "" }, /de 0 a 23/],
            [{ activa: "1", desde: "25", hasta: "6", formales: "" }, /de 0 a 23/],
            [{ activa: "1", desde: "0", hasta: "6", formales: "general" }, /no son IDs de canal: general/],
        ]) {
            const mal = formulario(campos);
            await paneladmin.handleModal(null, mal);
            expect(mal.reply.mock.calls[0][0].content).toMatch(error);
        }

        const ok = formulario({ activa: "1", desde: "1", hasta: "8", formales: `<#${FORMAL}>, 333333333333333333` });
        await paneladmin.handleModal(null, ok);
        expect(guildSettings.getSettings(P).duende).toMatchObject({
            madrugada_activa: true,
            madrugada_desde: 1,
            madrugada_hasta: 8,
            canales_formales: `${FORMAL},333333333333333333`,
        });
        expect(tono(ok.update.mock.calls[0][0])).toBe(
            `🌙 Más borde de 01:00 a 08:00\n👔 Más formal en <#${FORMAL}>, <#333333333333333333>`,
        );
    });
});
