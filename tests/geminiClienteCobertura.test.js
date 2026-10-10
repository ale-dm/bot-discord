// Cliente compartido de Gemini (services/geminiClient.js): la instancia del SDK (reutilizada mientras no cambie la
// clave), las llamadas con timeout que cancelan la petición, los contadores de uso y el aviso de cuota agotada.
// El SDK y el módulo de alertas están simulados: no sale nada a la red ni se envía ningún aviso real.
const mockGenerate = jest.fn();

jest.mock("@google/genai", () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerate } })),
}));
jest.mock("../src/systems/alertas", () => ({ alertar: jest.fn(() => Promise.resolve(1)) }));

const { GoogleGenAI } = require("@google/genai");
const alertas = require("../src/systems/alertas");
const gemini = require("../src/services/geminiClient");

const CLAVE_ORIGINAL = process.env.GOOGLE_API_KEY;
let uso;

beforeEach(() => {
    process.env.GOOGLE_API_KEY = "clave-gemini-prueba";
    mockGenerate.mockReset();
    alertas.alertar.mockClear();
    uso = gemini.getUsage();
});

afterEach(() => {
    if (CLAVE_ORIGINAL === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = CLAVE_ORIGINAL;
});

// Diferencia de cada contador desde el inicio del test.
const delta = () => {
    const ahora = gemini.getUsage();
    return Object.fromEntries(Object.keys(ahora).map((k) => [k, ahora[k] - uso[k]]));
};

describe("instancia del SDK", () => {
    test("sin GOOGLE_API_KEY se niega a trabajar con un mensaje claro", () => {
        delete process.env.GOOGLE_API_KEY;
        expect(() => gemini.getGenAI()).toThrow("Falta GOOGLE_API_KEY en variables de entorno");
    });

    test("reutiliza la misma instancia mientras la clave no cambie y crea otra si cambia", () => {
        process.env.GOOGLE_API_KEY = "clave-A";
        const a = gemini.getGenAI();
        const b = gemini.getGenAI();
        expect(b).toBe(a);

        const antes = GoogleGenAI.mock.calls.length;
        process.env.GOOGLE_API_KEY = "clave-B";
        const c = gemini.getGenAI();
        expect(c).not.toBe(a);
        expect(GoogleGenAI.mock.calls.length).toBe(antes + 1);
        expect(GoogleGenAI.mock.calls.at(-1)[0]).toEqual({ apiKey: "clave-B" });
    });
});

describe("generateContentWithTimeout: llamada normal", () => {
    test("devuelve la respuesta y suma los tokens al contador", async () => {
        const respuesta = {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
        };
        mockGenerate.mockResolvedValueOnce(respuesta);
        const r = await gemini.generateContentWithTimeout({ model: "gemini-test", contents: "hola" }, 0);
        expect(r).toBe(respuesta);
        expect(delta()).toEqual({ llamadas: 1, errores: 0, cuotaAgotada: 0, tokensEntrada: 12, tokensSalida: 7 });
    });

    test("sin timeout no añade señal de cancelación y no toca los parámetros de quien llama", async () => {
        mockGenerate.mockResolvedValueOnce({});
        const params = { model: "m", contents: "x", config: { temperature: 0.4 } };
        await gemini.generateContentWithTimeout(params, 0);
        const enviado = mockGenerate.mock.calls[0][0];
        expect(enviado.config).toEqual({ temperature: 0.4 });
        expect("abortSignal" in enviado.config).toBe(false);
        expect(params.config).toEqual({ temperature: 0.4 });
    });

    test("con timeout pasa una AbortSignal y no ensucia la configuración original", async () => {
        mockGenerate.mockResolvedValueOnce({});
        const params = { model: "m", contents: "x", config: { temperature: 0.4 } };
        await gemini.generateContentWithTimeout(params, 60000);
        const enviado = mockGenerate.mock.calls[0][0];
        expect(enviado.config.abortSignal).toBeInstanceOf(AbortSignal);
        expect(enviado.config.abortSignal.aborted).toBe(false);
        expect(params.config).not.toHaveProperty("abortSignal");
    });

    test("sin configuración ni uso de tokens en la respuesta, no falla y no suma tokens", async () => {
        mockGenerate.mockResolvedValueOnce({});
        const r = await gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0);
        expect(r).toEqual({});
        expect(mockGenerate.mock.calls[0][0].config).toEqual({});
        expect(delta()).toEqual({ llamadas: 1, errores: 0, cuotaAgotada: 0, tokensEntrada: 0, tokensSalida: 0 });
    });

    test("un timeout negativo también equivale a no tener timeout", async () => {
        mockGenerate.mockResolvedValueOnce({});
        await gemini.generateContentWithTimeout({ model: "m", contents: "x" }, -1);
        expect("abortSignal" in mockGenerate.mock.calls[0][0].config).toBe(false);
    });
});

describe("generateContentWithTimeout: timeout y errores", () => {
    test("si la petición tarda más del timeout se cancela y se lanza con la etiqueta", async () => {
        // Simula una petición que solo termina cuando la señal se cancela.
        mockGenerate.mockImplementationOnce(
            ({ config }) =>
                new Promise((_, reject) => {
                    config.abortSignal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
                }),
        );
        await expect(gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 30, "Duende")).rejects.toThrow(
            "Duende timeout tras 30ms",
        );
        expect(delta()).toMatchObject({ llamadas: 1, errores: 1, cuotaAgotada: 0 });
        expect(alertas.alertar).not.toHaveBeenCalled();
    });

    test("sin etiqueta el mensaje de timeout usa Gemini", async () => {
        mockGenerate.mockImplementationOnce(
            ({ config }) =>
                new Promise((_, reject) => {
                    config.abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        );
        await expect(gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 20)).rejects.toThrow("Gemini timeout tras 20ms");
    });

    test("un error que no es de cuota se relanza tal cual, sin avisar", async () => {
        const error = Object.assign(new Error("PROHIBITED_CONTENT"), { status: 400 });
        mockGenerate.mockRejectedValueOnce(error);
        const lanzado = await gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0).catch((e) => e);
        expect(lanzado).toBe(error);
        expect(delta()).toMatchObject({ errores: 1, cuotaAgotada: 0 });
        expect(alertas.alertar).not.toHaveBeenCalled();
    });

    test("un valor que no es un Error (texto) también se relanza sin romper el registro", async () => {
        mockGenerate.mockRejectedValueOnce("fallo raro");
        await expect(gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0)).rejects.toBe("fallo raro");
        expect(delta().errores).toBe(1);
    });

    test("un 429 cuenta como cuota agotada, avisa por alertas y relanza el error original", async () => {
        const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
        mockGenerate.mockRejectedValueOnce(error);
        const lanzado = await gemini.generateContentWithTimeout({ model: "gemini-2.5-flash", contents: "x" }, 0, "IA").catch((e) => e);

        expect(lanzado).toBe(error);
        expect(delta()).toMatchObject({ errores: 1, cuotaAgotada: 1 });
        expect(alertas.alertar).toHaveBeenCalledTimes(1);
        const aviso = alertas.alertar.mock.calls[0][0];
        expect(aviso.clave).toBe("gemini-cuota");
        expect(aviso.titulo).toContain("Gemini sin cuota");
        expect(aviso.detalle).toContain("IA con **gemini-2.5-flash**: Too Many Requests");
    });

    test("RESOURCE_EXHAUSTED o «rate limit» en el texto también cuentan como cuota", async () => {
        mockGenerate.mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED: límite de peticiones\nlínea de detalle que no debe salir"));
        await gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0).catch(() => {});
        expect(delta().cuotaAgotada).toBe(1);
        const detalle = alertas.alertar.mock.calls[0][0].detalle;
        expect(detalle).toContain("RESOURCE_EXHAUSTED: límite de peticiones");
        expect(detalle).not.toContain("línea de detalle");

        mockGenerate.mockRejectedValueOnce(new Error("You hit a rate limit"));
        await gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0).catch(() => {});
        expect(delta().cuotaAgotada).toBe(2);
    });

    test("si el aviso de cuota falla, se registra y el error de Gemini sigue llegando", async () => {
        alertas.alertar.mockImplementationOnce(() => Promise.reject(new Error("canal de alertas caído")));
        mockGenerate.mockRejectedValueOnce(Object.assign(new Error("quota"), { status: 429 }));
        await expect(gemini.generateContentWithTimeout({ model: "m", contents: "x" }, 0)).rejects.toThrow("quota");
        // Dar una vuelta al bucle de eventos para que el catch del aviso se ejecute.
        await new Promise((r) => setImmediate(r));
        expect(alertas.alertar).toHaveBeenCalledTimes(1);
    });
});

describe("contadores de uso", () => {
    test("getUsage devuelve una copia: modificarla no altera el contador real", () => {
        const copia = gemini.getUsage();
        copia.llamadas = 999999;
        expect(gemini.getUsage().llamadas).not.toBe(999999);
        expect(Object.keys(copia).sort()).toEqual(["cuotaAgotada", "errores", "llamadas", "tokensEntrada", "tokensSalida"]);
    });
});
