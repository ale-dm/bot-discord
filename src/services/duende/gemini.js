// Generación de respuestas del Duende con Gemini, incluido el bucle de herramientas.
const { FunctionCallingConfigMode } = require("@google/genai");
const { generateContentWithTimeout } = require("../geminiClient");
const { createLogger } = require("../../core/logger");
const tautulliClient = require("../tautulliClient");
const seerrClient = require("../seerrClient");
const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TIMEOUT_MS, DUENDE_MAX_TOKENS } = require("../../systems/duende/config");
const {
    DUENDE_CORE_TOOL_DECLARATIONS,
    DUENDE_PLEX_TOOL_DECLARATIONS,
    DUENDE_SEERR_TOOL_DECLARATIONS,
    DUENDE_TOOL_EXECUTORS,
} = require("./herramientas");

const log = createLogger("Duende");

function isGeminiProhibitedContentError(errorText) {
    const text = String(errorText || "").toLowerCase();
    return text.includes("prohibited_content") || text.includes("response was blocked");
}

function buildPromptFromParts(parts) {
    return (parts || [])
        .map((p) => (typeof p === "string" ? p : p?.text))
        .filter(Boolean)
        .join("\n");
}

const DUENDE_MAX_TOOL_ROUNDS = 4;

// Motivos por los que Gemini corta la respuesta por filtros. El SDK viejo lanzaba un error
// "Response was blocked..." en estos casos; el nuevo devuelve text vacío, así que se lanza a
// mano para que el reintento con prompt seguro (isGeminiProhibitedContentError) siga funcionando.
const GEMINI_BLOCK_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

async function generarConGemini(parts, options = {}) {
    const prompt = buildPromptFromParts(parts);
    if (!prompt) throw new Error("Prompt vacío para Gemini");
    if (!GEMINI_API_KEY) throw new Error("Falta GOOGLE_API_KEY en variables de entorno");

    const baseConfig = {
        systemInstruction: "Responde siempre de forma breve y concisa, máximo 1-2 frases. No te extiendas.",
        maxOutputTokens: Number(options.maxTokens || DUENDE_MAX_TOKENS),
        temperature: Number(options.temperature ?? process.env.DUENDE_TEMPERATURE ?? 0.7),
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
    };
    if (options.toolContext) {
        const hasChannelCtx = options.toolContext.guildId && options.toolContext.channelId;
        const plexAllowed = hasChannelCtx && tautulliClient.isChannelAllowed(options.toolContext.guildId, options.toolContext.channelId);
        const seerrAllowed = hasChannelCtx && seerrClient.isChannelAllowed(options.toolContext.guildId, options.toolContext.channelId);
        const declarations = [
            ...DUENDE_CORE_TOOL_DECLARATIONS,
            ...(plexAllowed ? DUENDE_PLEX_TOOL_DECLARATIONS : []),
            ...(seerrAllowed ? DUENDE_SEERR_TOOL_DECLARATIONS : []),
        ];
        baseConfig.tools = [{ functionDeclarations: declarations }];
    }

    const contentParts = [{ text: prompt }];
    for (const img of options.images || []) {
        if (!img || !img.buffer) continue;
        contentParts.push({ inlineData: { mimeType: img.mime || "image/png", data: img.buffer.toString("base64") } });
    }

    const contents = [{ role: "user", parts: contentParts }];
    const toolsCalledThisTurn = new Set();

    for (let round = 0; round <= DUENDE_MAX_TOOL_ROUNDS; round++) {
        const isLastRound = round === DUENDE_MAX_TOOL_ROUNDS;
        const config = { ...baseConfig };
        // En la última vuelta se corta la posibilidad de pedir más herramientas: si no,
        // Gemini puede devolver un turno solo con functionCall y sin texto, y como ya no
        // quedan rondas para atenderlo, la respuesta sale vacía y explota.
        // Forzar modo NONE obliga a responder en texto con lo que ya se le ha dado.
        if (isLastRound && options.toolContext) {
            config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
        }
        const response = await generateContentWithTimeout(
            { model: options.model || GEMINI_MODEL, contents, config },
            GEMINI_TIMEOUT_MS,
            "Gemini",
        );

        const blockReason = response?.promptFeedback?.blockReason;
        const finishReason = response?.candidates?.[0]?.finishReason;
        if (blockReason || GEMINI_BLOCK_FINISH_REASONS.has(finishReason)) {
            throw new Error(`Response was blocked (${blockReason || finishReason})`);
        }

        const functionCalls = response?.functionCalls;

        if (functionCalls && functionCalls.length && options.toolContext && !isLastRound) {
            const modelContent = response.candidates?.[0]?.content || {
                role: "model",
                parts: functionCalls.map((fc) => ({ functionCall: fc })),
            };
            contents.push(modelContent);

            const functionResponseParts = await Promise.all(
                functionCalls.map(async (fc) => {
                    let result;
                    try {
                        const executor = DUENDE_TOOL_EXECUTORS[fc.name];
                        result = executor ? await executor(fc.args, options.toolContext) : { error: "Herramienta desconocida." };
                    } catch (toolErr) {
                        log.warn(`Error ejecutando herramienta ${fc.name}: ` + (toolErr && toolErr.message));
                        result = { error: "No se pudo obtener el dato." };
                    }
                    log.info(`Herramienta usada: ${fc.name}(${JSON.stringify(fc.args || {})}) -> ${JSON.stringify(result)}`);
                    toolsCalledThisTurn.add(fc.name);
                    return { functionResponse: { id: fc.id, name: fc.name, response: result } };
                }),
            );
            // En @google/genai las respuestas de herramientas van con rol "user" (el SDK viejo usaba "function").
            contents.push({ role: "user", parts: functionResponseParts });
            continue;
        }

        const text = response?.text || "";

        if (finishReason === "MAX_TOKENS") {
            // No se puede recuperar la parte que faltó, pero al menos queda registrado
            // el porqué en vez de tener que adivinarlo por una frase cortada a medias.
            log.warn(`Respuesta cortada por MAX_TOKENS (maxOutputTokens=${baseConfig.maxOutputTokens}). Texto entregado: "${text}"`);
        }

        // Detector de alucinación de acción: si el texto suena a "ya lo he pedido/hecho"
        // pero la herramienta de escritura nunca se llamó de verdad en este turno, el
        // modelo se está inventando el resultado de una acción real. No se puede arreglar
        // el texto ya generado, pero queda registrado para poder pillarlo en el momento.
        if (
            text &&
            /\bya\s+(te\s+|se\s+|le\s+)?(lo\s+|la\s+)?he\s+pedido\b|\bya\s+est[aá]\s+pedid[oa]\b|\bpedido\s+ya\b/i.test(text) &&
            !toolsCalledThisTurn.has("solicitar_contenido_seerr")
        ) {
            log.warn(
                `Posible alucinación: el texto afirma haber pedido algo en Seerr pero 'solicitar_contenido_seerr' no se llamó en este turno. Texto: "${text}"`,
            );
        }

        if (!text || typeof text !== "string") throw new Error("Respuesta vacía de Gemini");
        return text;
    }

    throw new Error("Gemini no devolvió respuesta tras usar herramientas");
}

module.exports = { generarConGemini, buildPromptFromParts, isGeminiProhibitedContentError };
