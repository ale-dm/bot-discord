// Ajustes del Duende que vienen de .env (los de cada servidor están en guildSettings: duende.*).
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 20000);
const DUENDE_MAX_TOKENS = Number(process.env.DUENDE_MAX_TOKENS || 1024);
const DUENDE_MAX_TOKENS_FALLBACK = Number(process.env.DUENDE_MAX_TOKENS_FALLBACK || 512);
const DUENDE_HISTORY_LIMIT = Number(process.env.DUENDE_HISTORY_LIMIT || 20);
const DUENDE_DAILY_LIMIT = Number(process.env.DUENDE_DAILY_LIMIT || 50);
const DUENDE_PROMPT_MSG_MAX_CHARS = Number(process.env.DUENDE_PROMPT_MSG_MAX_CHARS || 280);
const DUENDE_LOG_FULL_PROMPT = String(process.env.DUENDE_LOG_FULL_PROMPT || "0") === "1";

module.exports = {
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_MS,
    DUENDE_MAX_TOKENS,
    DUENDE_MAX_TOKENS_FALLBACK,
    DUENDE_HISTORY_LIMIT,
    DUENDE_DAILY_LIMIT,
    DUENDE_PROMPT_MSG_MAX_CHARS,
    DUENDE_LOG_FULL_PROMPT,
};
