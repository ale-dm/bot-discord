// /duende de principio a fin con Gemini simulado: construcción del prompt, bucle de
// herramientas, recorte de la respuesta, historial y permisos de /duende olvida, recuerda y personas.
// Carpeta de datos nueva en cada ejecución: el historial y los perfiles se guardan en disco.
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-duende-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.DUENDE_GIF_PROB = "0";

const mockRespuestas = [];
const mockPeticiones = [];
jest.mock("../src/services/geminiClient", () => ({
    generateContentWithTimeout: jest.fn(async (params) => {
        mockPeticiones.push(JSON.parse(JSON.stringify(params.contents)));
        return mockRespuestas.shift();
    }),
}));

const duende = require("../src/commands/duende/duende");
const { conversationHistory } = require("../src/systems/duende/memoria");
const perfiles = require("../src/systems/duende/perfiles");
const db = require("../src/core/db");

const texto = (t) => ({
    text: t,
    functionCalls: undefined,
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: t }] } }],
});
const llamadaHerramienta = (name, args) => ({
    text: undefined,
    functionCalls: [{ name, args }],
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name, args } }] } }],
});

function fakeInteraction({
    sub = "talk",
    textoUsuario = "hola",
    user = { id: "u1", username: "alex" },
    opciones = {},
    admin = false,
} = {}) {
    const enviados = [];
    return {
        enviados,
        id: "msg-1",
        user,
        guildId: undefined,
        guild: undefined,
        member: { permissions: { has: () => admin } },
        channel: { id: "canal-test", send: async (c) => enviados.push(c) },
        deferReply: jest.fn(async () => {}),
        editReply: async (p) => enviados.push(typeof p === "string" ? p : p.content),
        followUp: async (p) => enviados.push(typeof p === "string" ? p : p.content),
        options: {
            getSubcommand: () => sub,
            getString: (n) => (n === "texto" ? textoUsuario : (opciones[n] ?? null)),
            getUser: (n) => opciones[n] ?? null,
        },
    };
}

beforeEach(() => {
    mockRespuestas.length = 0;
    mockPeticiones.length = 0;
});

test("responde, recorta a 2 frases y guarda el historial", async () => {
    mockRespuestas.push(texto("Hola, pesado. ¿Qué quieres ahora? Tercera frase que sobra."));
    const i = fakeInteraction({ textoUsuario: "hola duende" });
    await duende.hablar(null, i);
    expect(i.enviados).toEqual(["Hola, pesado. ¿Qué quieres ahora?"]);
    const hist = conversationHistory["canal-test"];
    expect(hist.map((m) => m.role)).toEqual(["user", "duende"]);
    expect(mockPeticiones[0][0].parts[0].text).toMatch(/hola duende/);
});

test("usa herramientas y responde con el resultado", async () => {
    mockRespuestas.push(llamadaHerramienta("tirar_dado", { caras: 20 }), texto("Te ha salido lo que te ha salido."));
    const i = fakeInteraction({ textoUsuario: "tira un dado de 20" });
    await duende.hablar(null, i);
    expect(i.enviados).toEqual(["Te ha salido lo que te ha salido."]);
    // La segunda petición lleva la respuesta de la herramienta.
    const respuestaHerramienta = mockPeticiones[1].at(-1).parts[0].functionResponse;
    expect(respuestaHerramienta.name).toBe("tirar_dado");
    expect(respuestaHerramienta.response.caras).toBe(20);
});

test("si Gemini bloquea la respuesta, reintenta con un prompt neutro", async () => {
    mockRespuestas.push(
        { text: undefined, promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, candidates: [] },
        texto("Vale, en tono neutro."),
    );
    const i = fakeInteraction({ textoUsuario: "algo borde" });
    await duende.hablar(null, i);
    expect(i.enviados).toEqual(["Vale, en tono neutro."]);
    expect(mockPeticiones).toHaveLength(2);
});

test("el perfil de quien habla llega al prompt", async () => {
    db.prepare("DELETE FROM duende_perfiles").run();
    perfiles.guardarDescripcion({ discordId: "u1", username: "alex", nombre: "Alex", descripcion: "Fan del Betis" });
    mockRespuestas.push(texto("Vale."));
    await duende.hablar(null, fakeInteraction({ textoUsuario: "¿qué opinas de mí?" }));
    expect(JSON.stringify(mockPeticiones[0])).toMatch(/Fan del Betis/);
});
