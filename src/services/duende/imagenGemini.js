// Generación de imagen de /imagen con el endpoint REST de Gemini (generateContent), con reintentos ante 503/429.
// Sacado de commands/duende/imagen.js.

require("dotenv").config();
const { logWarn } = require("../../core/logger");

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";

// gemini-2.0-flash-exp-image-generation genera imágenes nativas via generateContent (v1beta)
const IMAGE_GEN_MODEL = process.env.IMAGE_GEN_MODEL || "gemini-2.0-flash-exp-image-generation";
const IMAGE_GEN_MAX_RETRIES = Number(process.env.IMAGE_GEN_MAX_RETRIES || 3);
const IMAGE_GEN_RETRY_BASE_MS = Number(process.env.IMAGE_GEN_RETRY_BASE_MS || 5_000);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cuerpo de la petición: el prompt de texto y, si las hay, las imágenes de referencia en base64. */
function construirPayload(promptStr, images) {
    const parts = [{ text: promptStr }];
    for (const img of images) {
        parts.push({
            inlineData: {
                mimeType: img.mime,
                data: img.buffer.toString("base64"),
            },
        });
    }
    return {
        contents: [{ role: "user", parts }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
        },
    };
}

/** Registra por qué la API no devolvió imagen (y lanza si fue bloqueada). Devuelve el finishReason. */
function diagnosticarSinImagen(data, partsOut, attempt) {
    // Loguear qué devolvió la API para diagnóstico
    const textParts = partsOut
        .filter((p) => p.text)
        .map((p) => p.text)
        .join(" ");
    const finishReason = data.candidates?.[0]?.finishReason || "?";
    const blockReason = data.promptFeedback?.blockReason || null;
    logWarn(
        `[Imagen] Sin imagen en intento ${attempt + 1}/${IMAGE_GEN_MAX_RETRIES + 1} — finishReason: ${finishReason}${blockReason ? ", blockReason: " + blockReason : ""}${textParts ? ", texto: " + textParts.slice(0, 200) : ""}`,
    );

    if (blockReason) {
        throw new Error(`Contenido bloqueado por la API: ${blockReason}`);
    }
    return finishReason;
}

/**
 * Llama directamente al endpoint REST de Nano Banana via :generateContent.
 * @param {string} promptStr - Texto del prompt.
 * @param {{ buffer: Buffer, mime: string }[]} images - Imágenes de referencia opcionales.
 */
async function generateImageREST(promptStr, images = [], signal = undefined) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = construirPayload(promptStr, images);

    let lastError;
    for (let attempt = 0; attempt <= IMAGE_GEN_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const backoffMs = IMAGE_GEN_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            logWarn(
                `[Imagen] Reintento ${attempt}/${IMAGE_GEN_MAX_RETRIES} tras ${backoffMs / 1000}s (error previo: ${lastError?.status ?? "?"})`,
            );
            await delay(backoffMs);
            if (signal?.aborted) throw signal.reason || new Error("Abortado");
        }

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
        });

        if (res.status === 503 || res.status === 429) {
            const errorText = await res.text();
            lastError = { status: res.status, text: errorText };
            if (attempt < IMAGE_GEN_MAX_RETRIES) continue;
            throw new Error(`Error API (${res.status}): ${errorText}`);
        }

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Error API (${res.status}): ${errorText}`);
        }

        const data = await res.json();
        const partsOut = data.candidates?.[0]?.content?.parts || [];
        const imagePart = partsOut.find((p) => p.inlineData?.data);

        if (!imagePart) {
            const finishReason = diagnosticarSinImagen(data, partsOut, attempt);
            lastError = { status: "NO_IMAGE", text: `finishReason: ${finishReason}` };
            if (attempt < IMAGE_GEN_MAX_RETRIES) continue;
            throw new Error("La API respondió, pero no incluyó ninguna imagen.");
        }

        return {
            imageBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
            mimeType: imagePart.inlineData.mimeType || "image/png",
        };
    }
    // Should never reach here, but satisfy linter
    throw lastError ? new Error(`Error API (${lastError.status}): ${lastError.text}`) : new Error("Error desconocido");
}

module.exports = { generateImageREST, IMAGE_GEN_MODEL, IMAGE_GEN_MAX_RETRIES };
