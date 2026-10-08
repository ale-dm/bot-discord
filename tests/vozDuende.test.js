// Conversación por voz con el Duende (/escuchar → duende.run con silentTextReply): si la respuesta hablada falla (TTS
// sin audio, sin conexión...), el Duende contesta por texto en vez de quedarse mudo. Y la voz recibe el texto sin
// menciones de Discord.
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-voz-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.DUENDE_GIF_PROB = "0";

const mockRespuestas = [];
jest.mock("../src/services/geminiClient", () => ({
    generateContentWithTimeout: jest.fn(async () => mockRespuestas.shift()),
}));
const mockVoz = jest.fn();
jest.mock("../src/services/duende/voz", () => ({
    ...jest.requireActual("../src/services/duende/voz"),
    tryVoiceReply: (...args) => mockVoz(...args),
}));

const duende = require("../src/commands/duende/duende");

const texto = (t) => ({
    text: t,
    functionCalls: undefined,
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: t }] } }],
});

function charlaDeVoz() {
    const enviados = [];
    return {
        enviados,
        id: "voz-1",
        user: { id: "u-voz", username: "ale" },
        channel: { id: "canal-voz-test", send: async (c) => enviados.push(c), isTextBased: () => true },
        forceVoiceReply: true,
        silentTextReply: true,
        deferReply: async () => {},
        editReply: async () => {},
        followUp: async () => {},
        options: { getSubcommand: () => "talk", getString: (n) => (n === "texto" ? "hola duende" : null) },
    };
}

beforeEach(() => {
    mockRespuestas.length = 0;
    mockVoz.mockReset();
});

test("si la voz funciona, no se manda nada por texto", async () => {
    mockRespuestas.push(texto("Hola, pesado."));
    mockVoz.mockResolvedValue(true);
    const i = charlaDeVoz();
    await duende.hablar(null, i);
    expect(mockVoz).toHaveBeenCalledWith(null, i, "Hola, pesado.");
    expect(i.enviados).toEqual([]);
});

test("si la voz falla, la respuesta va por texto al canal", async () => {
    mockRespuestas.push(texto("Hola, pesado."));
    mockVoz.mockResolvedValue(false);
    const i = charlaDeVoz();
    await duende.hablar(null, i);
    expect(i.enviados).toEqual([{ content: "🗣️ Hola, pesado.", allowedMentions: { parse: ["users"] } }]);
});

test("en el chat normal la voz no se espera ni cambia la respuesta por texto", async () => {
    mockRespuestas.push(texto("Qué quieres."));
    mockVoz.mockReturnValue(new Promise(() => {})); // una voz que no termina nunca no bloquea la respuesta
    const i = { ...charlaDeVoz(), silentTextReply: false, forceVoiceReply: false, enviados: [] };
    i.editReply = async (p) => i.enviados.push(typeof p === "string" ? p : p.content);
    await duende.hablar(null, i);
    expect(i.enviados).toEqual(["Qué quieres."]);
});
