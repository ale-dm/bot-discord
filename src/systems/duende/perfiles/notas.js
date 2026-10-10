// Memoria de las notas de cada perfil por embeddings: las más relacionadas con el mensaje actual, con los vectores
// guardados en duende_notas_vectores para no volver a pedirlos a Gemini.
const crypto = require("crypto");
const db = require("../../../core/db");
const embeddings = require("../../../services/duende/embeddings");

// A partir de cuántas notas merece la pena buscar por embeddings las más relacionadas con el
// mensaje actual en vez de darlas todas: con pocas no hace falta gastar una llamada a Gemini.
const NOTAS_RELEVANTES_UMBRAL = 6;
const NOTAS_RELEVANTES_MAX = 6;

function hashNota(texto) {
    return crypto.createHash("sha1").update(texto).digest("hex");
}

function vectoresCacheados(perfilId, hashes) {
    const mapa = new Map();
    if (!hashes.length) return mapa;
    const placeholders = hashes.map(() => "?").join(",");
    const filas = db
        .prepare(`SELECT nota_hash, vector FROM duende_notas_vectores WHERE perfil_id = ? AND nota_hash IN (${placeholders})`)
        .all(perfilId, ...hashes);
    for (const f of filas) {
        try {
            mapa.set(f.nota_hash, JSON.parse(f.vector));
        } catch {
            // Vector corrupto: se trata como si no estuviera cacheado y se recalcula.
        }
    }
    return mapa;
}

function guardarVectores(perfilId, entradas) {
    const insert = db.prepare("INSERT OR REPLACE INTO duende_notas_vectores (perfil_id, nota_hash, vector, creado_en) VALUES (?, ?, ?, ?)");
    db.transaction(() => {
        for (const { hash, vector } of entradas) insert.run(perfilId, hash, JSON.stringify(vector), Date.now());
    })();
}

/**
 * Las notas de una persona más relacionadas con `textoConsulta` (el mensaje actual), en vez de
 * siempre las últimas MAX_NOTAS. Con pocas notas no llama a Gemini — no hace falta. Si la
 * llamada falla (sin API key, sin cuota, red...) cae a las más recientes, como antes de esto.
 * @returns {Promise<string[]>}
 */
async function notasRelevantes(perfil, textoConsulta, { max = NOTAS_RELEVANTES_MAX } = {}) {
    const notas = perfil?.notas || [];
    if (notas.length <= Math.max(max, NOTAS_RELEVANTES_UMBRAL)) return notas;

    const hashes = notas.map(hashNota);
    const cache = vectoresCacheados(perfil.id, hashes);
    const faltantes = notas.filter((_, i) => !cache.has(hashes[i]));

    let vectorConsulta;
    if (faltantes.length) {
        const calculados = await embeddings.embedTexts([...faltantes, textoConsulta]);
        if (!calculados) return notas.slice(-max); // fallback: como antes de tener embeddings
        guardarVectores(
            perfil.id,
            faltantes.map((nota, i) => ({ hash: hashNota(nota), vector: calculados[i] })),
        );
        faltantes.forEach((nota, i) => cache.set(hashNota(nota), calculados[i]));
        vectorConsulta = calculados[calculados.length - 1];
    } else {
        const calculados = await embeddings.embedTexts([textoConsulta]);
        if (!calculados) return notas.slice(-max);
        [vectorConsulta] = calculados;
    }

    return notas
        .map((nota, i) => ({ nota, score: embeddings.cosineSimilarity(cache.get(hashes[i]), vectorConsulta) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map((n) => n.nota);
}

module.exports = { notasRelevantes };
