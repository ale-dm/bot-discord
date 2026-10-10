// Constantes de la conversación en directo: modelo, voz, cortes por inactividad y tope de duración, y cómo se llama al Duende.

const { GEMINI_TTS_VOICE } = require("../../geminiTts");

// Tertulia (#16): cuando alguien deja de hablar durante este tiempo, se cierra el turno de Gemini.
const FIN_TURNO_TERTULIA_MS = 1200;

const LIVE_MODEL = process.env.DUENDE_LIVE_MODEL || "gemini-3.8-live";
const LIVE_VOICE = process.env.DUENDE_LIVE_VOICE || process.env.DUENDE_TTS_VOICE || GEMINI_TTS_VOICE;
// Se cobra mientras la conexión esté abierta, no solo cuando se habla: sin esto, dejarse la
// llamada olvidada puede salir caro. No es opcional.
const IDLE_DISCONNECT_MS = Number(process.env.DUENDE_LIVE_IDLE_DISCONNECT_MS || 5 * 60 * 1000);
// Tope duro, pase lo que pase, por si algo falla y la sesión se queda colgada sin más.
const MAX_DURATION_MS = Number(process.env.DUENDE_LIVE_MAX_DURATION_MS || 30 * 60 * 1000);
const IDLE_CHECK_INTERVAL_MS = 15_000;
// Palabra para que el Duende conteste en modo "solo si le llaman" (ver empezarConversacion).
const PALABRA_LLAMADA = /\bduende\b/i;

module.exports = {
    FIN_TURNO_TERTULIA_MS,
    LIVE_MODEL,
    LIVE_VOICE,
    IDLE_DISCONNECT_MS,
    MAX_DURATION_MS,
    IDLE_CHECK_INTERVAL_MS,
    PALABRA_LLAMADA,
};
