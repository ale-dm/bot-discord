// GIFs de Giphy para acompañar algunas respuestas del Duende.
const { createLogger } = require("../core/logger");

const log = createLogger("Duende");

const GIPHY_KEY = process.env.GIPHY_API_KEY || "";
const gifKeywords = [
    "risa",
    "enfado",
    "fail",
    "molesto",
    "borde",
    "circo",
    "perro",
    "laugh",
    "angry",
    "annoyed",
    "edge",
    "circus",
    "dog",
    "funny",
    "humor",
];

// Simple in-memory cache for GIF URLs per query to avoid repeated Giphy calls
const gifCache = new Map();
const GIF_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function extractKeywords(text) {
    if (!text) return [];
    const stopwords = new Set([
        "que",
        "de",
        "la",
        "el",
        "en",
        "y",
        "a",
        "los",
        "las",
        "un",
        "una",
        "con",
        "por",
        "para",
        "se",
        "no",
        "es",
        "son",
        "al",
        "lo",
        "del",
        "como",
        "su",
        "mi",
        "me",
        "te",
    ]);
    return Array.from(
        new Set(
            text
                .toLowerCase()
                .replace(/["'`.,!?;:()[\]{}<>/\\]/g, " ")
                .split(/\s+/)
                .map((w) => w.trim())
                .filter((w) => w.length >= 3 && !stopwords.has(w)),
        ),
    );
}

function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}
async function searchGiphy(query) {
    if (!GIPHY_KEY) {
        log.debug("GIPHY_API_KEY no definido: sin GIF.");
        return null;
    }
    if (!query || typeof query !== "string") return null;
    const q = query.trim();
    const cacheKey = `giphy:${q}`;
    const cached = gifCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < GIF_CACHE_TTL) return cached.url;

    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_KEY)}&q=${encodeURIComponent(q)}&limit=16&rating=pg-13`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();

        if (data && Array.isArray(data.data) && data.data.length) {
            const gif = pickRandom(data.data);
            const gifUrl = gif?.images?.original?.url || gif?.images?.downsized_medium?.url || gif?.images?.fixed_height?.url || null;
            if (gifUrl) {
                gifCache.set(cacheKey, { url: gifUrl, ts: Date.now() });
                return gifUrl;
            }
        }
    } catch (err) {
        if (err && (err.name === "AbortError" || err.name === "TimeoutError")) log.warn(`Giphy request timed out for query: ${q}`);
        else log.error(`Error en searchGiphy: ${err && err.message}`);
    }
    return null;
}

async function getGifForText(text, userInput = "") {
    if (!GIPHY_KEY) return null;
    const candidates = [];
    const lowerText = (text || "").toLowerCase();
    const lowerInput = (userInput || "").toLowerCase();

    // 1) explicit keyword list intersection (high priority)
    for (const kw of gifKeywords) {
        if (lowerText.includes(kw) || lowerInput.includes(kw)) candidates.push(kw);
    }

    // 2) extracted keywords from text and userInput
    const extracted = extractKeywords(`${text || ""} ${userInput || ""}`);
    for (const e of extracted) {
        if (!candidates.includes(e)) candidates.push(e);
    }

    // 3) trailing words (common for short queries)
    const trailing = lowerInput
        .split(/\s+/)
        .filter(Boolean)
        .slice(-3)
        .reverse()
        .concat(lowerText.split(/\s+/).filter(Boolean).slice(-3).reverse());
    for (const t of trailing) {
        if (t && !candidates.includes(t)) candidates.push(t);
    }

    // 4) full text and input as fallback
    if (text && !candidates.includes(text)) candidates.push(text);
    if (userInput && !candidates.includes(userInput)) candidates.push(userInput);

    // 5) last resort
    candidates.push("funny");

    for (const q of candidates) {
        try {
            const g = await searchGiphy(q);
            if (g) return g;
        } catch (err) {
            log.error("Error buscando GIF con candidato " + q + ": " + (err && err.message));
        }
    }
    return null;
}

module.exports = { getGifForText };
