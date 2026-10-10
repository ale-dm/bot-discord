// Llamadas de /ia a la API de Gemini: la consulta de texto con la instrucción del agente y la imagen por REST.
// Sacado de commands/duende/ia.js para que el comando solo tenga validación, embeds y mensajes de error.

require("dotenv").config();
const { generateContentWithTimeout } = require("../geminiClient");
const { logWarn } = require("../../core/logger");

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30_000);
const IMAGE_GEN_MODEL = process.env.IMAGE_GEN_MODEL || "gemini-2.0-flash-exp-image-generation";
const IMAGE_GEN_MAX_RETRIES_IA = Number(process.env.IMAGE_GEN_MAX_RETRIES || 3);
const IMAGE_GEN_RETRY_BASE_MS_IA = Number(process.env.IMAGE_GEN_RETRY_BASE_MS || 5_000);

// ─── Llamada a Gemini con system instruction personalizada ────────────────────
async function llamarGemini(promptText, systemInstruction) {
    if (!GEMINI_API_KEY) throw new Error("Falta GOOGLE_API_KEY en las variables de entorno");

    const response = await generateContentWithTimeout(
        {
            model: GEMINI_MODEL,
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            config: {
                systemInstruction,
                maxOutputTokens: 2048,
                temperature: 0.7,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                ],
            },
        },
        GEMINI_TIMEOUT_MS,
        "Gemini",
    );

    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini bloqueó la petición (${blockReason})`);

    const text = response?.text || "";
    if (!text) throw new Error("Respuesta vacía de Gemini");
    return text;
}

// ─── Generación de imagen vía REST (igual que imagen.js) ─────────────────────
/** Registra por qué la API no devolvió imagen (y lanza si fue bloqueada). Devuelve el finishReason. */
function diagnosticarSinImagen(data, partsOut, attempt) {
    const textParts = partsOut
        .filter((p) => p.text)
        .map((p) => p.text)
        .join(" ");
    const finishReason = data.candidates?.[0]?.finishReason || "?";
    const blockReason = data.promptFeedback?.blockReason || null;
    logWarn(
        `[IA/Imagen] Sin imagen en intento ${attempt + 1}/${IMAGE_GEN_MAX_RETRIES_IA + 1} — finishReason: ${finishReason}${blockReason ? ", blockReason: " + blockReason : ""}${textParts ? ", texto: " + textParts.slice(0, 200) : ""}`,
    );
    if (blockReason) throw new Error(`Contenido bloqueado por la API: ${blockReason}`);
    return finishReason;
}

async function generarImagenREST(promptStr, signal = undefined) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: promptStr }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };

    let lastError;
    for (let attempt = 0; attempt <= IMAGE_GEN_MAX_RETRIES_IA; attempt++) {
        if (attempt > 0) {
            const backoffMs = IMAGE_GEN_RETRY_BASE_MS_IA * Math.pow(2, attempt - 1);
            logWarn(`[IA/Imagen] Reintento ${attempt}/${IMAGE_GEN_MAX_RETRIES_IA} tras ${backoffMs / 1000}s`);
            await new Promise((r) => setTimeout(r, backoffMs));
            if (signal?.aborted) throw signal.reason || new Error("Abortado");
        }

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
        });

        if (res.status === 503 || res.status === 429) {
            const errText = await res.text();
            lastError = { status: res.status, text: errText };
            if (attempt < IMAGE_GEN_MAX_RETRIES_IA) continue;
            throw new Error(`Error API imagen (${res.status}): ${errText.slice(0, 300)}`);
        }

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Error API imagen (${res.status}): ${errText.slice(0, 300)}`);
        }

        const data = await res.json();
        const partsOut = data.candidates?.[0]?.content?.parts || [];
        const imagePart = partsOut.find((p) => p.inlineData?.data);

        if (!imagePart) {
            const finishReason = diagnosticarSinImagen(data, partsOut, attempt);
            lastError = { status: "NO_IMAGE", text: `finishReason: ${finishReason}` };
            if (attempt < IMAGE_GEN_MAX_RETRIES_IA) continue;
            throw new Error("La API no devolvió ninguna imagen");
        }

        return {
            buffer: Buffer.from(imagePart.inlineData.data, "base64"),
            mimeType: imagePart.inlineData.mimeType || "image/png",
        };
    }
    throw lastError ? new Error(`Error API imagen (${lastError.status}): ${lastError.text}`) : new Error("Error desconocido");
}

module.exports = { llamarGemini, generarImagenREST };
