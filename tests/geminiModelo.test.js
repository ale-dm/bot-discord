// Comprobar que el modelo de Gemini existe y usa herramientas: botón 🤖 Probar Gemini de 🩺 Sistema y al cambiar el
// modelo en Config Global → 🤖 Duende. Gemini simulado.
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const mockRespuestas = [];
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(async (params) => {
        const r = mockRespuestas.shift();
        if (r instanceof Error) throw r;
        return typeof r === "function" ? r(params) : r;
    }),
}));
const guildSettings = require("../src/systems/guildSettings");
const { comprobarModelo, modeloDe, textoComprobacion } = require("../src/services/duende/gemini");
const { GEMINI_MODEL } = require("../src/systems/duende/config");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-gemini";
const llamaHerramienta = { functionCalls: [{ name: "comprobar_conexion", args: { numero: 7 } }] };

test("un modelo que llama a la herramienta de prueba está bien", async () => {
    mockRespuestas.push((params) => {
        expect(params.config.tools[0].functionDeclarations[0].name).toBe("comprobar_conexion");
        return llamaHerramienta;
    });
    const r = await comprobarModelo("gemini-bueno");
    expect(r).toMatchObject({ ok: true, existe: true, usaHerramientas: true, modelo: "gemini-bueno" });
    expect(textoComprobacion(r)).toMatch(/✅ \*\*gemini-bueno\*\* funciona/);
});

test("uno que responde sin usar la herramienta se marca (el Duende se inventaría los datos)", async () => {
    mockRespuestas.push({ text: "Vale, comprobado.", functionCalls: undefined });
    const r = await comprobarModelo("gemini-lite");
    expect(r).toMatchObject({ ok: false, existe: true, usaHerramientas: false });
    expect(textoComprobacion(r)).toMatch(/^⚠️ gemini-lite responde, pero no ha usado la herramienta/);
});

test("uno retirado (404) no existe; otros errores se cuentan tal cual", async () => {
    mockRespuestas.push(Object.assign(new Error("models/gemini-viejo is not found for API version v1beta"), { status: 404 }));
    const viejo = await comprobarModelo("gemini-viejo");
    expect(viejo).toMatchObject({ ok: false, existe: false });
    expect(textoComprobacion(viejo)).toBe("❌ El modelo gemini-viejo no existe o ya no está disponible.");

    mockRespuestas.push(new Error("Gemini timeout tras 20000ms"));
    expect((await comprobarModelo("gemini-lento")).motivo).toMatch(/respondió con un error: Gemini timeout/);
});

test("el modelo del servidor es el del panel, o el de .env si está vacío", () => {
    expect(modeloDe(G)).toBe(GEMINI_MODEL);
    guildSettings.setSetting(G, "duende.model", "gemini-del-panel");
    expect(modeloDe(G)).toBe("gemini-del-panel");
    guildSettings.setSetting(G, "duende.model", "");
});

describe("panel de admin", () => {
    const interaccion = (extra) => ({
        guildId: G,
        guild: { id: G },
        user: { id: "admin", tag: "admin", username: "admin" },
        member: { permissions: { has: () => true } },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        ...extra,
    });
    const formularioDuende = (modelo) =>
        interaccion({
            customId: "paneladmin_cfg_duende_modal",
            fields: { getTextInputValue: (k) => ({ model: modelo, temperature: "0.7", history: "20" })[k] },
        });

    test("🤖 Probar Gemini prueba el modelo del servidor", async () => {
        mockRespuestas.push(llamaHerramienta);
        const i = interaccion({ customId: "paneladmin_sis_gemini" });
        await paneladmin.handleButton(null, i);
        expect(i.deferReply).toHaveBeenCalled();
        expect(i.editReply.mock.calls[0][0].content).toMatch(new RegExp(`✅ \\*\\*${GEMINI_MODEL}\\*\\* funciona`));
    });

    test("al cambiar el modelo en Config Global se prueba en el momento; si no cambia, no", async () => {
        mockRespuestas.push(Object.assign(new Error("not found"), { status: 404 }));
        const cambio = formularioDuende("gemini-que-no-existe");
        await paneladmin.handleModal(null, cambio);
        expect(guildSettings.getSettings(G).duende.model).toBe("gemini-que-no-existe");
        expect(cambio.editReply.mock.calls[0][0].content).toMatch(
            /actualizada\.\n❌ El modelo gemini-que-no-existe no existe.*\nVuelve a ✏️ Editar IA/s,
        );

        const igual = formularioDuende("gemini-que-no-existe");
        await paneladmin.handleModal(null, igual);
        expect(igual.deferReply).not.toHaveBeenCalled();
        expect(igual.reply.mock.calls[0][0].content).toBe("✅ Configuración de Duende actualizada.");
        expect(mockRespuestas).toHaveLength(0);
    });
});
