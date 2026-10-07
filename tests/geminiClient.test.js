// getGenAILive: la Live API (voz en directo) necesita v1alpha, no el v1beta de getGenAI — con
// v1beta el modelo da "is not found for API version v1beta, or is not supported for
// bidiGenerateContent" (visto en producción, /conversación se abría y se cerraba sola sin audio).
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const mockGoogleGenAI = jest.fn();
jest.mock("@google/genai", () => ({
    GoogleGenAI: jest.fn().mockImplementation((opts) => {
        mockGoogleGenAI(opts);
        return { opts };
    }),
}));

const { getGenAI, getGenAILive } = require("../src/services/geminiClient");

beforeEach(() => mockGoogleGenAI.mockClear());

test("getGenAI no fuerza ninguna versión de API (v1beta por defecto del SDK)", () => {
    getGenAI();
    expect(mockGoogleGenAI).toHaveBeenCalledWith(expect.not.objectContaining({ httpOptions: expect.anything() }));
});

test("getGenAILive pide v1alpha: la Live API no está disponible en v1beta", () => {
    getGenAILive();
    expect(mockGoogleGenAI).toHaveBeenCalledWith(expect.objectContaining({ httpOptions: { apiVersion: "v1alpha" } }));
});

test("getGenAILive reutiliza el cliente mientras la clave no cambie", () => {
    const a = getGenAILive();
    const llamadasTrasLaPrimera = mockGoogleGenAI.mock.calls.length;
    const b = getGenAILive();
    expect(a).toBe(b);
    expect(mockGoogleGenAI.mock.calls.length).toBe(llamadasTrasLaPrimera); // la segunda no crea otro cliente
});
