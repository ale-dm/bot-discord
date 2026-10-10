// Generar la respuesta del Duende: el límite diario de respuestas, el recorte del texto y la llamada a Gemini.

const { DUENDE_MAX_TOKENS, DUENDE_MAX_TOKENS_FALLBACK, DUENDE_DAILY_LIMIT } = require("../../../systems/duende/config");
const { generarConGemini, isGeminiProhibitedContentError } = require("../gemini");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende");

// Contador diario de respuestas
let dailyReplyCount = 0;
let dailyReplyDate = new Date().toDateString();
function checkAndIncrementDailyLimit() {
    const today = new Date().toDateString();
    if (today !== dailyReplyDate) {
        dailyReplyDate = today;
        dailyReplyCount = 0;
    }
    if (DUENDE_DAILY_LIMIT > 0 && dailyReplyCount >= DUENDE_DAILY_LIMIT) return false;
    dailyReplyCount++;
    return true;
}

function truncateText(value, maxLength) {
    const text = typeof value === "string" ? value : String(value || "");
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength);
}

function limitToSentences(value, maxSentences = 2) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    const sentences = raw.match(/[^.!?\n]+[.!?]?/g) || [raw];
    const compact = sentences.map((s) => s.trim()).filter(Boolean);
    if (!compact.length) return truncateText(raw, 220);
    return compact.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

// Pide la respuesta a Gemini. Si el contenido se bloquea (PROHIBITED_CONTENT) reintenta con un prompt seguro; si
// falla de otra forma, devuelve un texto de disculpa. Nunca lanza.
async function pedirRespuestaGemini({ parts, activeModel, temperature, imageAttachments, toolContext, userName, userInput }) {
    let text = "No estoy disponible.";
    try {
        text = await generarConGemini(parts, {
            maxTokens: DUENDE_MAX_TOKENS,
            model: activeModel,
            temperature,
            images: imageAttachments,
            toolContext,
        });
        log.info("Respuesta de Gemini: " + text);
    } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        if (isGeminiProhibitedContentError(errMsg)) {
            log.warn("Gemini bloqueó la respuesta por PROHIBITED_CONTENT. Reintentando con prompt seguro.");

            const safeParts = [
                { text: "Eres un asistente de Discord. Responde de forma breve, útil y respetuosa en español." },
                { text: `Usuario actual: ${userName}` },
                { text: `Mensaje del usuario: ${truncateText(userInput, 300)}` },
                {
                    text: 'Evita lenguaje ofensivo, amenazas, acoso o sexual explícito. Si tienes herramientas disponibles que te den datos reales o ejecuten la acción pedida, úsalas con normalidad — pedir contenido multimedia, consultar datos de otro usuario del mismo grupo, etc. no es "problemático", es el uso normal de este bot entre amigos. Solo niégate ante algo realmente dañino (amenazas reales, acoso serio, contenido sexual con menores...), nunca por simple prudencia ante una petición normal.',
                },
                { text: "Responde en 1-2 frases." },
            ];

            try {
                // Con toolContext también en este camino: si lo que se bloqueó fue solo el
                // TONO (personalidad muy agresiva chocando con el filtro de PROHIBITED_CONTENT
                // de Gemini, no configurable vía safetySettings), la acción real pedida por el
                // usuario sigue pudiendo completarse con un tono neutro — antes este fallback
                // no tenía herramientas y la funcionalidad entera se perdía, no solo el tono.
                text = await generarConGemini(safeParts, {
                    maxTokens: DUENDE_MAX_TOKENS_FALLBACK,
                    model: activeModel,
                    temperature,
                    toolContext,
                });
                log.warn("Reintento Gemini con prompt seguro completado (con herramientas). Texto: " + text);
            } catch (safeErr) {
                const safeErrMsg = safeErr && safeErr.message ? safeErr.message : String(safeErr);
                log.error("Error en reintento seguro de Gemini: " + safeErrMsg);
                text = "No puedo responder a ese contenido. Reformúlalo en términos más neutrales.";
            }
        } else {
            log.error(`Error al llamar a Gemini: ${errMsg}`);
            if (!text || text === "No estoy disponible.") {
                text = "Ahora mismo no puedo responder. Inténtalo de nuevo en unos segundos.";
            }
        }
    }
    return text;
}

module.exports = { checkAndIncrementDailyLimit, truncateText, limitToSentences, pedirRespuestaGemini };
