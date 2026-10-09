// Embeddings de Gemini: solo lo mínimo que necesita perfiles.notasRelevantes para comparar
// textos por similitud. $0,15/M tokens de entrada (la salida, el vector, no se cobra).
const { getGenAI } = require("../geminiClient");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende");

const EMBEDDING_MODEL = process.env.DUENDE_EMBEDDING_MODEL || "gemini-embedding-001";
// Con el volumen de notas de este server no hace falta más: menos dimensiones = vectores más
// pequeños que guardar y comparar, sin perder precisión que se note aquí.
const EMBEDDING_DIMENSIONS = 256;

/**
 * Un vector por texto, en el mismo orden. null si ha fallado la llamada entera (sin API key,
 * sin cuota, red...) — quien la usa debe caer a su alternativa sin embeddings en ese caso.
 * @param {string[]} texts
 * @returns {Promise<number[][]|null>}
 */
async function embedTexts(texts) {
    if (!texts || !texts.length) return [];
    try {
        const response = await getGenAI().models.embedContent({
            model: EMBEDDING_MODEL,
            contents: texts,
            config: { outputDimensionality: EMBEDDING_DIMENSIONS },
        });
        const vectores = response?.embeddings;
        if (!Array.isArray(vectores) || vectores.length !== texts.length || vectores.some((v) => !v?.values)) return null;
        return vectores.map((v) => v.values);
    } catch (err) {
        log.warn(`Embeddings: fallo al calcular ${texts.length} texto(s): ` + (err && err.message));
        return null;
    }
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (!na || !nb) return -1;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { embedTexts, cosineSimilarity };
