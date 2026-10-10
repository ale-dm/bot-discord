// Generación de la respuesta del Duende (chat/generar.js): el límite diario de respuestas, el recorte del texto y
// la llamada a Gemini con su reintento de seguridad (PROHIBITED_CONTENT). Gemini está simulado: no sale nada a la red.
// Los ajustes del Duende se leen al cargarse, así que el entorno se fija antes del require.
process.env.DUENDE_DAILY_LIMIT = "2";

// La fecha se controla para probar el cambio de día del contador. Solo se simula Date.
jest.useFakeTimers({ now: new Date("2026-10-10T12:00:00"), toFake: ["Date"] });

jest.mock("../src/services/duende/gemini", () => {
    const real = jest.requireActual("../src/services/duende/gemini");
    return { ...real, generarConGemini: jest.fn() };
});

const { generarConGemini } = require("../src/services/duende/gemini");
const generar = require("../src/services/duende/chat/generar");

afterAll(() => {
    jest.useRealTimers();
});

beforeEach(() => {
    generarConGemini.mockReset();
});

describe("límite diario de respuestas", () => {
    test("con DUENDE_DAILY_LIMIT=2 responde dos veces al día y luego se calla", () => {
        expect(generar.checkAndIncrementDailyLimit()).toBe(true);
        expect(generar.checkAndIncrementDailyLimit()).toBe(true);
        expect(generar.checkAndIncrementDailyLimit()).toBe(false);
        expect(generar.checkAndIncrementDailyLimit()).toBe(false);
    });

    test("al cambiar de día el contador vuelve a cero", () => {
        jest.setSystemTime(new Date("2026-10-11T00:00:30"));
        expect(generar.checkAndIncrementDailyLimit()).toBe(true);
        expect(generar.checkAndIncrementDailyLimit()).toBe(true);
        expect(generar.checkAndIncrementDailyLimit()).toBe(false);
    });

    test("con DUENDE_DAILY_LIMIT=0 no hay límite", () => {
        const anterior = process.env.DUENDE_DAILY_LIMIT;
        process.env.DUENDE_DAILY_LIMIT = "0";
        try {
            let sinLimite;
            jest.isolateModules(() => {
                sinLimite = require("../src/services/duende/chat/generar");
            });
            for (let i = 0; i < 50; i++) expect(sinLimite.checkAndIncrementDailyLimit()).toBe(true);
        } finally {
            process.env.DUENDE_DAILY_LIMIT = anterior;
        }
    });
});

describe("truncateText", () => {
    test("un texto que cabe sale igual", () => {
        expect(generar.truncateText("hola", 10)).toBe("hola");
        expect(generar.truncateText("abcde", 5)).toBe("abcde");
    });

    test("un texto más largo se corta al límite", () => {
        expect(generar.truncateText("abcdefgh", 3)).toBe("abc");
    });

    test("un valor que no es texto se convierte; vacío o nulo da cadena vacía", () => {
        expect(generar.truncateText(12345, 3)).toBe("123");
        expect(generar.truncateText(null, 3)).toBe("");
        expect(generar.truncateText(undefined, 3)).toBe("");
    });
});

describe("limitToSentences", () => {
    test("por defecto deja como mucho dos frases", () => {
        expect(generar.limitToSentences("Hola. Adiós. Hasta luego.")).toBe("Hola. Adiós.");
    });

    test("respeta el número de frases pedido, con un mínimo de una", () => {
        expect(generar.limitToSentences("Hola. Adiós. Hasta luego.", 1)).toBe("Hola.");
        expect(generar.limitToSentences("Hola. Adiós.", 0)).toBe("Hola.");
        expect(generar.limitToSentences("Hola. Adiós. Hasta luego.", 3)).toBe("Hola. Adiós. Hasta luego.");
    });

    test("un salto de línea también separa frases y se juntan con espacio", () => {
        expect(generar.limitToSentences("Línea uno\nLínea dos\nLínea tres")).toBe("Línea uno Línea dos");
    });

    test("admite signos de apertura y exclamaciones", () => {
        expect(generar.limitToSentences("¡Hola! ¿Qué tal?")).toBe("¡Hola! ¿Qué tal?");
    });

    test("un texto sin nada que contar se devuelve tal cual", () => {
        expect(generar.limitToSentences("...")).toBe("...");
        expect(generar.limitToSentences("sin puntuación ninguna")).toBe("sin puntuación ninguna");
    });

    test("vacío o nulo da cadena vacía", () => {
        expect(generar.limitToSentences("")).toBe("");
        expect(generar.limitToSentences("   ")).toBe("");
        expect(generar.limitToSentences(null)).toBe("");
    });
});

describe("pedirRespuestaGemini: camino normal", () => {
    const parts = [{ text: "Mensaje" }];
    const toolContext = { guildId: "g1", channelId: "c1" };
    const base = { parts, activeModel: "gemini-test", temperature: 0.5, toolContext, userName: "Ana", userInput: "hola" };

    test("devuelve el texto de Gemini y pasa modelo, temperatura, imágenes y herramientas", async () => {
        generarConGemini.mockResolvedValueOnce("¡Buenas!");
        const imagenes = [{ mimeType: "image/png", data: "AAAA" }];
        const texto = await generar.pedirRespuestaGemini({ ...base, imageAttachments: imagenes });
        expect(texto).toBe("¡Buenas!");
        expect(generarConGemini).toHaveBeenCalledTimes(1);
        expect(generarConGemini).toHaveBeenCalledWith(parts, {
            maxTokens: 1024,
            model: "gemini-test",
            temperature: 0.5,
            images: imagenes,
            toolContext,
        });
    });

    test("sin Gemini disponible no revienta: pide disculpas y no reintenta", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("socket hang up"));
        const texto = await generar.pedirRespuestaGemini(base);
        expect(texto).toBe("Ahora mismo no puedo responder. Inténtalo de nuevo en unos segundos.");
        expect(generarConGemini).toHaveBeenCalledTimes(1);
    });

    test("un error que no es un Error (texto suelto) también da la disculpa", async () => {
        generarConGemini.mockRejectedValueOnce("boom");
        expect(await generar.pedirRespuestaGemini(base)).toBe("Ahora mismo no puedo responder. Inténtalo de nuevo en unos segundos.");
    });
});

describe("pedirRespuestaGemini: bloqueo por contenido (PROHIBITED_CONTENT)", () => {
    const toolContext = { guildId: "g1", channelId: "c1" };

    test("con PROHIBITED_CONTENT reintenta con un prompt seguro, sin imágenes y con herramientas", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("PROHIBITED_CONTENT: bloqueado"));
        generarConGemini.mockResolvedValueOnce("Respuesta segura");

        const texto = await generar.pedirRespuestaGemini({
            parts: [{ text: "original" }],
            activeModel: "gemini-test",
            temperature: 0.9,
            imageAttachments: [{ data: "x" }],
            toolContext,
            userName: "Ana",
            userInput: "x".repeat(400),
        });

        expect(texto).toBe("Respuesta segura");
        expect(generarConGemini).toHaveBeenCalledTimes(2);
        const [partesSeguras, opciones] = generarConGemini.mock.calls[1];
        const textos = partesSeguras.map((p) => p.text);
        expect(textos).toContain("Usuario actual: Ana");
        // El mensaje del usuario se recorta a 300 caracteres en el prompt seguro.
        expect(textos).toContain(`Mensaje del usuario: ${"x".repeat(300)}`);
        expect(textos.at(-1)).toBe("Responde en 1-2 frases.");
        expect(opciones).toEqual({ maxTokens: 512, model: "gemini-test", temperature: 0.9, toolContext });
        expect(opciones).not.toHaveProperty("images");
    });

    test("el texto «response was blocked» también activa el reintento seguro", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("Response was blocked due to SAFETY"));
        generarConGemini.mockResolvedValueOnce("Vale, con tono neutro");
        expect(await generar.pedirRespuestaGemini({ parts: [], toolContext, userName: "Ana", userInput: "hola" })).toBe(
            "Vale, con tono neutro",
        );
        expect(generarConGemini).toHaveBeenCalledTimes(2);
    });

    test("si el reintento también se bloquea o falla, pide reformular", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("PROHIBITED_CONTENT"));
        generarConGemini.mockRejectedValueOnce(new Error("PROHIBITED_CONTENT otra vez"));
        const texto = await generar.pedirRespuestaGemini({ parts: [], toolContext, userName: "Ana", userInput: "hola" });
        expect(texto).toBe("No puedo responder a ese contenido. Reformúlalo en términos más neutrales.");
        expect(generarConGemini).toHaveBeenCalledTimes(2);
    });

    test("si el reintento falla por otra causa, también pide reformular", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("PROHIBITED_CONTENT"));
        generarConGemini.mockRejectedValueOnce(new Error("timeout de Gemini"));
        expect(await generar.pedirRespuestaGemini({ parts: [], toolContext, userName: "Ana", userInput: "hola" })).toBe(
            "No puedo responder a ese contenido. Reformúlalo en términos más neutrales.",
        );
    });

    test("sin mensaje de usuario el prompt seguro no inventa texto", async () => {
        generarConGemini.mockRejectedValueOnce(new Error("PROHIBITED_CONTENT"));
        generarConGemini.mockResolvedValueOnce("ok");
        await generar.pedirRespuestaGemini({ parts: [], toolContext, userName: "Ana" });
        const textos = generarConGemini.mock.calls[1][0].map((p) => p.text);
        expect(textos).toContain("Mensaje del usuario: ");
    });
});
