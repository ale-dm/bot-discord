// perfiles.notasRelevantes: con pocas notas no llama a Gemini; con muchas, se queda con las más
// parecidas al mensaje actual (embeddings cacheados en duende_notas_vectores); si Gemini falla,
// cae a las últimas notas, como se hacía antes de esto.
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const mockEmbedContent = jest.fn();
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    getGenAI: () => ({ models: { embedContent: mockEmbedContent } }),
}));

const db = require("../src/core/db");
const perfiles = require("../src/systems/duende/perfiles");

beforeEach(() => {
    mockEmbedContent.mockReset();
    db.prepare("DELETE FROM duende_notas_vectores").run();
});

test("con pocas notas no llama a Gemini y las da todas", async () => {
    const relevantes = await perfiles.notasRelevantes({ id: 1, notas: ["a", "b", "c"] }, "cualquier cosa");
    expect(relevantes).toEqual(["a", "b", "c"]);
    expect(mockEmbedContent).not.toHaveBeenCalled();
});

test("con muchas notas, se queda con las más parecidas al mensaje", async () => {
    const notas = [
        "le gusta el fútbol",
        "odia el cilantro",
        "vive en Madrid",
        "juega al ajedrez",
        "tiene un gato",
        "no soporta el reguetón",
        "colecciona sellos",
    ];
    mockEmbedContent.mockImplementation(async ({ contents }) => ({
        embeddings: contents.map((texto) => ({ values: /fútbol|deporte/.test(texto) ? [1, 0, 0] : [0, 1, 0] })),
    }));
    const relevantes = await perfiles.notasRelevantes({ id: 2, notas }, "me encanta el deporte", { max: 2 });
    expect(relevantes).toContain("le gusta el fútbol");
    expect(relevantes).toHaveLength(2);
});

test("si Gemini falla, cae a las últimas notas", async () => {
    mockEmbedContent.mockRejectedValue(new Error("sin cuota"));
    const notas = Array.from({ length: 8 }, (_, i) => `nota ${i}`);
    const relevantes = await perfiles.notasRelevantes({ id: 3, notas }, "algo", { max: 3 });
    expect(relevantes).toEqual(notas.slice(-3));
});

test("cachea los vectores: la segunda vez solo pide el vector de la consulta nueva", async () => {
    const notas = Array.from({ length: 8 }, (_, i) => `nota ${i}`);
    mockEmbedContent.mockImplementation(async ({ contents }) => ({
        embeddings: contents.map(() => ({ values: [1, 2, 3] })),
    }));

    await perfiles.notasRelevantes({ id: 4, notas }, "consulta 1", { max: 3 });
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    expect(mockEmbedContent.mock.calls[0][0].contents).toHaveLength(9); // 8 notas + la consulta

    mockEmbedContent.mockClear();
    await perfiles.notasRelevantes({ id: 4, notas }, "consulta 2", { max: 3 });
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    expect(mockEmbedContent.mock.calls[0][0].contents).toHaveLength(1); // ya cacheadas, solo la consulta
});
