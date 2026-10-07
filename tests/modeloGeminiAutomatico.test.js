// Cambio automático de modelo de Gemini (F-AD-03, issue #39): al arrancar, si el modelo de un servidor no existe o no
// usa herramientas, se pasa solo al primero de respaldo que funcione (con alerta y auditoría); si el fallo es de paso
// (cuota, timeout), solo se avisa. Gemini simulado: cada modelo responde según la tabla `comportamiento`.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.GEMINI_MODEL = "gemini-env";
process.env.GEMINI_FALLBACK_MODELS = "gemini-respaldo-1, gemini-respaldo-2";

const comportamiento = {};
const probados = [];
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(async ({ model }) => {
        probados.push(model);
        const c = comportamiento[model] || "404";
        if (c === "ok") return { functionCalls: [{ name: "comprobar_conexion", args: { numero: 1 } }] };
        if (c === "sin_herramientas") return { text: "Vale.", functionCalls: undefined };
        if (c === "cuota") throw Object.assign(new Error("RESOURCE_EXHAUSTED: quota"), { status: 429 });
        throw Object.assign(new Error(`models/${model} is not found`), { status: 404 });
    }),
}));
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const alertas = require("../src/systems/alertas");
const modeloGemini = require("../src/systems/duende/modeloGemini");

const modeloDe = (g) => guildSettings.getSettings(g).duende.model;
let avisos;
beforeEach(() => {
    probados.length = 0;
    for (const k of Object.keys(comportamiento)) delete comportamiento[k];
    avisos = jest.spyOn(alertas, "alertar").mockResolvedValue(1);
});
afterEach(() => jest.restoreAllMocks());

test("los de respaldo: el de .env y los de GEMINI_FALLBACK_MODELS, sin repetir ni el que falla", () => {
    expect(modeloGemini.candidatos("gemini-viejo")).toEqual(["gemini-env", "gemini-respaldo-1", "gemini-respaldo-2"]);
    expect(modeloGemini.candidatos("gemini-env")).toEqual(["gemini-respaldo-1", "gemini-respaldo-2"]);
});

test("un modelo retirado (404) se cambia en todos sus servidores por el primero de respaldo que funciona", async () => {
    guildSettings.setSetting("g1", "duende.model", "gemini-viejo");
    guildSettings.setSetting("g2", "duende.model", "gemini-viejo");
    guildSettings.setSetting("g3", "duende.model", "gemini-bueno");
    Object.assign(comportamiento, { "gemini-bueno": "ok", "gemini-env": "sin_herramientas", "gemini-respaldo-1": "ok" });

    const r = await modeloGemini.comprobarAlArrancar(["g1", "g2", "g3"]);
    expect(r).toEqual([
        expect.objectContaining({ modelo: "gemini-viejo", ok: false, nuevo: "gemini-respaldo-1", guildIds: ["g1", "g2"] }),
        { modelo: "gemini-bueno", ok: true, guildIds: ["g3"] },
    ]);
    // Cada modelo, una vez; el segundo de respaldo ni se prueba.
    expect(probados).toEqual(["gemini-viejo", "gemini-env", "gemini-respaldo-1", "gemini-bueno"]);
    expect([modeloDe("g1"), modeloDe("g2"), modeloDe("g3")]).toEqual(["gemini-respaldo-1", "gemini-respaldo-1", "gemini-bueno"]);
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(avisos.mock.calls[0][0]).toMatchObject({ clave: "gemini-modelo:gemini-viejo", titulo: "🤖 He cambiado el modelo de Gemini" });
    expect(avisos.mock.calls[0][0].detalle).toMatch(/no existe o ya no está disponible[\s\S]*usa ahora \*\*gemini-respaldo-1\*\*/);
    const auditoria = db
        .prepare("SELECT guildId, actorId, details FROM admin_audit WHERE action = 'settings.duende.modelo_automatico'")
        .all();
    expect(auditoria.map((a) => [a.guildId, a.actorId, JSON.parse(a.details).ahora])).toEqual([
        ["g1", "bot", "gemini-respaldo-1"],
        ["g2", "bot", "gemini-respaldo-1"],
    ]);
});

test("uno que no usa las herramientas también se cambia; el del .env vale si funciona", async () => {
    guildSettings.setSetting("g4", "duende.model", "gemini-lite");
    Object.assign(comportamiento, { "gemini-lite": "sin_herramientas", "gemini-env": "ok" });
    await modeloGemini.comprobarAlArrancar(["g4"]);
    expect(modeloDe("g4")).toBe("gemini-env");
});

test("un error de paso (cuota, timeout) no cambia nada: solo se avisa", async () => {
    guildSettings.setSetting("g5", "duende.model", "gemini-sin-cuota");
    Object.assign(comportamiento, { "gemini-sin-cuota": "cuota", "gemini-env": "ok" });
    const [r] = await modeloGemini.comprobarAlArrancar(["g5"]);
    expect(r).toMatchObject({ ok: false, guildIds: ["g5"] });
    expect(r.nuevo).toBeUndefined();
    expect(probados).toEqual(["gemini-sin-cuota"]);
    expect(modeloDe("g5")).toBe("gemini-sin-cuota");
    expect(avisos.mock.calls[0][0].titulo).toBe("🤖 El modelo de Gemini no funciona bien");
    expect(avisos.mock.calls[0][0].detalle).not.toMatch(/respaldo/);
});

test("si ninguno de respaldo funciona, se queda como estaba y el aviso lo dice", async () => {
    guildSettings.setSetting("g6", "duende.model", "gemini-roto");
    await modeloGemini.comprobarAlArrancar(["g6"]);
    expect(probados).toEqual(["gemini-roto", "gemini-env", "gemini-respaldo-1", "gemini-respaldo-2"]);
    expect(modeloDe("g6")).toBe("gemini-roto");
    expect(avisos.mock.calls[0][0].detalle).toMatch(/Tampoco funciona ninguno de los de respaldo \(GEMINI_FALLBACK_MODELS\)/);
});

test("sin modelo en el panel se prueba el de .env, y si falla se pone uno en el panel", async () => {
    Object.assign(comportamiento, { "gemini-respaldo-2": "ok" });
    await modeloGemini.comprobarAlArrancar(["g-sin-modelo"]);
    expect(probados).toEqual(["gemini-env", "gemini-respaldo-1", "gemini-respaldo-2"]);
    expect(modeloDe("g-sin-modelo")).toBe("gemini-respaldo-2");
});
