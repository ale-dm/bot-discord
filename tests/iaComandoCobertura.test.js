// /ia (#239): consulta al agente de Gemini (simulada), construcción de la respuesta en embeds, cooldown por
// persona, mensajes de error según la causa y generación opcional de imagen (fetch simulado con reintentos).
// Las constantes del módulo se leen al cargarlo, así que el entorno se fija antes del require.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.IMAGE_GEN_RETRY_BASE_MS = "1";
process.env.IMAGE_GEN_MAX_RETRIES = "2";
process.env.IMAGE_GEN_TIMEOUT_MS = "80";

jest.mock("../src/services/geminiClient", () => ({ generateContentWithTimeout: jest.fn() }));

const geminiClient = require("../src/services/geminiClient");
const ia = require("../src/commands/duende/ia");

const cliente = { user: { displayAvatarURL: () => "https://cdn.test/bot.png" } };
let n = 0;

function interaccion({ prompt = "¿qué es un agujero negro?", agente = null, imagen = null, id = `u-${++n}` } = {}) {
    return {
        user: { id, tag: `persona${n}#0001`, username: `persona${n}`, displayAvatarURL: () => "https://cdn.test/p.png" },
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        options: {
            getString: (k) => (k === "prompt" ? prompt : k === "agente" ? agente : null),
            getBoolean: (k) => (k === "generar_imagen" ? imagen : null),
        },
    };
}

// Respuestas del modelo de texto: una cadena de texto o un error.
const textoDeGemini = (text) => geminiClient.generateContentWithTimeout.mockResolvedValueOnce({ text });

// Una respuesta de la API de imagen con una imagen PNG mínima en base64.
const IMAGEN_B64 = Buffer.from("png-falso").toString("base64");
const respuestaImagen = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: IMAGEN_B64, mimeType: "image/png" } }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });

let fetchSpy;

beforeEach(() => {
    geminiClient.generateContentWithTimeout.mockReset();
    fetchSpy = jest.spyOn(global, "fetch");
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("definición del comando", () => {
    test("se llama ia, con prompt obligatorio y 8 agentes para elegir", () => {
        expect(ia.data.name).toBe("ia");
        const opciones = ia.data.options;
        expect(opciones.find((o) => o.name === "prompt").required).toBe(true);
        expect(opciones.find((o) => o.name === "agente").choices).toHaveLength(8);
        expect(opciones.find((o) => o.name === "generar_imagen").type).toBe(5);
    });
});

describe("respuesta del agente", () => {
    test("usa el agente general por defecto y responde con un embed", async () => {
        textoDeGemini("Un agujero negro es una región del espacio…");
        const i = interaccion();
        await ia.run(cliente, i);
        const llamada = geminiClient.generateContentWithTimeout.mock.calls[0][0];
        expect(llamada.config.systemInstruction).toContain("asistente de IA útil");
        const embed = i.editReply.mock.calls[0][0].embeds[0].data;
        expect(embed.author.name).toBe("🤖 Asistente General");
        expect(embed.description).toBe("Un agujero negro es una región del espacio…");
        expect(embed.fields[0].value).toBe("¿qué es un agujero negro?");
        expect(embed.footer.text).toContain("persona");
    });

    test("el agente elegido cambia el tono de la instrucción del sistema", async () => {
        textoDeGemini("Érase una vez…");
        const i = interaccion({ agente: "creativo" });
        await ia.run(cliente, i);
        const llamada = geminiClient.generateContentWithTimeout.mock.calls[0][0];
        expect(llamada.config.systemInstruction).toContain("asistente creativo");
        expect(i.editReply.mock.calls[0][0].embeds[0].data.author.name).toBe("🎨 Asistente Creativo");
    });

    test("un agente desconocido cae al general", async () => {
        textoDeGemini("ok");
        const i = interaccion({ agente: "inventado" });
        await ia.run(cliente, i);
        expect(i.editReply.mock.calls[0][0].embeds[0].data.author.name).toBe("🤖 Asistente General");
    });

    test("una respuesta larga se parte en varios embeds numerados", async () => {
        const linea = "Una línea de texto bastante normal para rellenar la respuesta.\n";
        textoDeGemini(linea.repeat(200));
        const i = interaccion();
        await ia.run(cliente, i);
        const embeds = i.editReply.mock.calls[0][0].embeds;
        expect(embeds.length).toBeGreaterThan(1);
        expect(embeds[1].data.footer.text).toBe(`Parte 2 de ${embeds.length}`);
        expect(embeds.every((e) => e.data.description.length <= 4000)).toBe(true);
    });

    test("una consulta muy larga se recorta en el campo de consulta", async () => {
        textoDeGemini("ok");
        const i = interaccion({ prompt: "x".repeat(300) });
        await ia.run(cliente, i);
        const campo = i.editReply.mock.calls[0][0].embeds[0].data.fields[0].value;
        expect(campo.length).toBe(254);
        expect(campo.endsWith("…")).toBe(true);
    });
});

describe("errores del modelo de texto", () => {
    async function fallaCon(error) {
        geminiClient.generateContentWithTimeout.mockRejectedValueOnce(error);
        const i = interaccion();
        await ia.run(cliente, i);
        return i.editReply.mock.calls.at(-1)[0].content;
    }

    test("un bloqueo de seguridad se explica con el aviso de filtros", async () => {
        geminiClient.generateContentWithTimeout.mockResolvedValueOnce({ promptFeedback: { blockReason: "SAFETY" } });
        const i = interaccion();
        await ia.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("filtros de seguridad");
    });

    test("una respuesta vacía cuenta como error genérico", async () => {
        textoDeGemini("");
        const i = interaccion();
        await ia.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].content).toContain("Hubo un error");
    });

    test("un tiempo agotado, la cuota y la saturación tienen su propio aviso", async () => {
        expect(await fallaCon(new Error("Gemini timeout tras 30s"))).toContain("tardó demasiado");
        expect(await fallaCon(new Error("quota exceeded"))).toContain("cuota");
        expect(await fallaCon(new Error("503 high demand"))).toContain("saturado");
    });

    test("si tampoco se puede avisar del error, no se rompe", async () => {
        geminiClient.generateContentWithTimeout.mockRejectedValueOnce(new Error("algo raro"));
        const i = interaccion();
        i.editReply.mockRejectedValue(new Error("Discord caído"));
        await expect(ia.run(cliente, i)).resolves.toBeUndefined();
    });

    test("un error deja libre a la persona para volver a intentarlo al momento", async () => {
        geminiClient.generateContentWithTimeout.mockRejectedValueOnce(new Error("fallo"));
        textoDeGemini("ahora sí");
        const i = interaccion({ id: "persona-reintento" });
        await ia.run(cliente, i);
        const segunda = interaccion({ id: "persona-reintento" });
        await ia.run(cliente, segunda);
        expect(segunda.editReply.mock.calls[0][0].embeds[0].data.description).toBe("ahora sí");
    });
});

describe("cooldown", () => {
    test("una segunda consulta seguida de la misma persona se rechaza con los segundos que faltan", async () => {
        textoDeGemini("primera");
        await ia.run(cliente, interaccion({ id: "persona-cooldown" }));
        const otra = interaccion({ id: "persona-cooldown" });
        await ia.run(cliente, otra);
        expect(otra.editReply.mock.calls[0][0].content).toMatch(/Espera \*\*\d+s\*\*/);
        expect(geminiClient.generateContentWithTimeout).toHaveBeenCalledTimes(1);
    });
});

describe("configuración", () => {
    test("sin clave de API avisa y no consulta nada", async () => {
        jest.resetModules();
        const saved = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        try {
            const sinClave = require("../src/commands/duende/ia");
            const i = interaccion();
            await sinClave.run(cliente, i);
            expect(i.editReply.mock.calls[0][0].content).toContain("no está configurada");
            expect(geminiClient.generateContentWithTimeout).not.toHaveBeenCalled();
        } finally {
            process.env.GOOGLE_API_KEY = saved;
        }
    });
});

describe("generación de imagen", () => {
    test("con generar_imagen, adjunta la imagen y lo indica en el embed", async () => {
        textoDeGemini("texto");
        fetchSpy.mockResolvedValueOnce(respuestaImagen());
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        const payload = i.editReply.mock.calls.at(-1)[0];
        expect(payload.files).toHaveLength(1);
        expect(payload.embeds[0].data.fields.find((f) => f.name === "🎨 Imagen")).toBeDefined();
        const [url, opciones] = fetchSpy.mock.calls[0];
        expect(url).toContain("generativelanguage.googleapis.com");
        expect(JSON.parse(opciones.body).generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    });

    test("un 429 se reintenta y la segunda vez sale bien", async () => {
        textoDeGemini("texto");
        fetchSpy.mockResolvedValueOnce(new Response("cuota", { status: 429 })).mockResolvedValueOnce(respuestaImagen());
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(i.editReply.mock.calls.at(-1)[0].files).toHaveLength(1);
    });

    test("si la API nunca devuelve imagen, el embed avisa sin tirar la respuesta de texto", async () => {
        textoDeGemini("texto");
        fetchSpy.mockImplementation(
            async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 }),
        );
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        const payload = i.editReply.mock.calls.at(-1)[0];
        expect(payload.files).toBeUndefined();
        expect(payload.embeds[0].data.fields.find((f) => f.name === "⚠️ Imagen")).toBeDefined();
        expect(payload.embeds[0].data.description).toBe("texto");
    });

    test("un error HTTP que no se reintenta también cae en el aviso de imagen", async () => {
        textoDeGemini("texto");
        fetchSpy.mockResolvedValueOnce(new Response("petición mala", { status: 400 }));
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].embeds[0].data.fields.some((f) => f.name === "⚠️ Imagen")).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("un bloqueo de contenido en la imagen no se reintenta", async () => {
        textoDeGemini("texto");
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }), { status: 200 }),
        );
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(i.editReply.mock.calls.at(-1)[0].embeds[0].data.fields.some((f) => f.name === "⚠️ Imagen")).toBe(true);
    });

    test("si la imagen tarda más de su plazo, se corta y se avisa", async () => {
        textoDeGemini("texto");
        fetchSpy.mockImplementation(
            (_url, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(signal.reason));
                }),
        );
        const i = interaccion({ imagen: true });
        await ia.run(cliente, i);
        expect(i.editReply.mock.calls.at(-1)[0].embeds[0].data.fields.some((f) => f.name === "⚠️ Imagen")).toBe(true);
    });
});
