// Cliente compartido de Gemini (SDK @google/genai, sustituto del deprecado
// @google/generative-ai). Una sola instancia para todo el bot en vez de crear
// un cliente nuevo en cada mensaje.
const { GoogleGenAI } = require("@google/genai");
const { createLogger } = require("../core/logger");

const log = createLogger("Gemini");

let client = null;
let clientKey = null;

function getGenAI() {
    const apiKey = process.env.GOOGLE_API_KEY || "";
    if (!apiKey) throw new Error("Falta GOOGLE_API_KEY en variables de entorno");
    if (!client || clientKey !== apiKey) {
        client = new GoogleGenAI({ apiKey });
        clientKey = apiKey;
    }
    return client;
}

// Consumo acumulado desde el arranque (lo muestra /diagnostico).
const usage = { llamadas: 0, errores: 0, cuotaAgotada: 0, tokensEntrada: 0, tokensSalida: 0 };

function isQuotaError(err) {
    const text = String(err?.message || "");
    return err?.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text);
}

/**
 * generateContent con timeout que CANCELA la petición HTTP (AbortSignal), no solo
 * deja de esperarla como hacía el Promise.race anterior.
 * @param {object} params - { model, contents, config }
 * @param {number} timeoutMs - 0 o negativo = sin timeout
 * @param {string} [label] - quién llama (Duende, IA...), para el mensaje de error y el log
 */
async function generateContentWithTimeout(params, timeoutMs, label = "Gemini") {
    const config = { ...(params.config || {}) };
    if (timeoutMs > 0) config.abortSignal = AbortSignal.timeout(timeoutMs);
    const t0 = Date.now();
    usage.llamadas++;
    try {
        const response = await getGenAI().models.generateContent({ ...params, config });
        const u = response?.usageMetadata || {};
        usage.tokensEntrada += Number(u.promptTokenCount) || 0;
        usage.tokensSalida += Number(u.candidatesTokenCount) || 0;
        log.debug(
            `${label}: ${params.model} ok en ${Date.now() - t0} ms · tokens entrada=${u.promptTokenCount ?? "?"} salida=${u.candidatesTokenCount ?? "?"} · fin=${response?.candidates?.[0]?.finishReason ?? "?"}`,
        );
        return response;
    } catch (err) {
        usage.errores++;
        const ms = Date.now() - t0;
        if (config.abortSignal?.aborted) {
            log.warn(`${label}: ${params.model} cancelado por timeout (${timeoutMs} ms)`);
            throw new Error(`${label} timeout tras ${timeoutMs}ms`);
        }
        if (isQuotaError(err)) {
            usage.cuotaAgotada++;
            log.warn(`${label}: ${params.model} sin cuota o con rate limit (${ms} ms): ${String(err.message).split("\n")[0]}`);
        } else {
            log.warn(`${label}: ${params.model} falló en ${ms} ms (status ${err?.status ?? "?"}): ${String(err.message).split("\n")[0]}`);
        }
        throw err;
    }
}

function getUsage() {
    return { ...usage };
}

module.exports = { getGenAI, generateContentWithTimeout, getUsage, isQuotaError };
