// Voz del bot (/tts y las respuestas habladas del Duende) con Gemini TTS. Devuelve un WAV listo para reproducir.
//
// Modelos: GEMINI_TTS_MODEL (por defecto gemini-3.8-flash-tts) y, si ese falla, los de GEMINI_TTS_FALLBACK_MODELS, en
// orden. El último que ha funcionado se prueba primero la siguiente vez.
// - Los modelos 3.x van por la Interactions API (POST /v1beta/interactions), la que documenta Google para TTS: el texto
//   se manda tal cual (se lee literalmente; el tono, si se quiere, va aparte en speech_metadata.style) y devuelven WAV.
// - Los 2.x van por generateContent y devuelven PCM crudo (audio/L16, 24 kHz), que aquí se envuelve en un WAV.
// Antes solo se usaba gemini-2.5-flash-preview-tts por generateContent; Google lo está retirando (octubre de 2026) y
// respondía HTTP 200 pero sin audio (finishReason OTHER), así que el bot entraba al canal de voz y no decía nada.
const { Readable } = require("stream");
const { createLogger } = require("../core/logger");

const log = createLogger("TTS");

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const MODELO_POR_DEFECTO = "gemini-3.8-flash-tts";
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || MODELO_POR_DEFECTO;
const GEMINI_TTS_FALLBACK_MODELS = (process.env.GEMINI_TTS_FALLBACK_MODELS ?? "gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
// Tono opcional para los modelos 3.x ("natural y cercano, en español de España"...). Vacío: el del modelo.
const GEMINI_TTS_STYLE = String(process.env.GEMINI_TTS_STYLE || "").trim();
// Por petición, y en total con reintentos y modelos de respaldo (para no dejar a nadie esperando un minuto).
const GEMINI_TTS_TIMEOUT_MS = Number(process.env.GEMINI_TTS_TIMEOUT_MS || 20000);
const GEMINI_TTS_TOTAL_TIMEOUT_MS = Number(process.env.GEMINI_TTS_TOTAL_TIMEOUT_MS || 45000);
// Intentos con el mismo modelo cuando responde sin audio (los modelos de TTS lo hacen a veces y al repetir funciona).
const INTENTOS_POR_MODELO = 2;
const GEMINI_TTS_SAMPLE_RATE = 24000;
const GEMINI_TTS_VOICE = process.env.DUENDE_TTS_VOICE || "Puck";

let modeloQueFunciona = null;

function pcmToWav(pcmBuffer, sampleRate = GEMINI_TTS_SAMPLE_RATE, channels = 1, bitDepth = 16) {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
}

const usaInteractions = (modelo) => !/^gemini-[12]\./.test(modelo);

/** URL y cuerpo de la petición de TTS para un modelo. */
function peticion(modelo, texto, voz) {
    if (usaInteractions(modelo)) {
        return {
            url: `${BASE_URL}/interactions`,
            body: {
                model: modelo,
                input: [
                    {
                        type: "user_input",
                        content: [
                            {
                                type: "text",
                                text: texto,
                                ...(GEMINI_TTS_STYLE ? { annotations: [{ type: "speech_metadata", style: GEMINI_TTS_STYLE }] } : {}),
                            },
                        ],
                    },
                ],
                response_format: { type: "audio" },
                generation_config: { speech_config: [{ voice: voz }] },
            },
        };
    }
    // Los 2.x tomaban la petición como una instrucción: se les pide leerlo tal cual.
    return {
        url: `${BASE_URL}/models/${modelo}:generateContent`,
        body: {
            contents: [
                {
                    parts: [
                        {
                            text: `TTS. Lee en voz alta, tal cual y sin añadir ni comentar nada, exactamente esta transcripcion: "${texto}"`,
                        },
                    ],
                },
            ],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
            },
        },
    };
}

/**
 * El audio de una respuesta, venga de la Interactions API (steps → model_output → content de tipo audio) o de
 * generateContent (candidates → parts → inlineData). Se busca en todo el JSON, y se queda el último trozo de audio.
 * @returns {{ base64: string, mime: string } | null}
 */
function extraerAudio(data) {
    let audio = null;
    const visitar = (o) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(visitar);
        if (o.inlineData?.data) audio = { base64: o.inlineData.data, mime: o.inlineData.mimeType || o.inlineData.mime_type || "" };
        else if (o.type === "audio" && typeof o.data === "string" && o.data)
            audio = { base64: o.data, mime: o.mime_type || o.mimeType || "" };
        Object.values(o).forEach(visitar);
    };
    visitar(data);
    return audio;
}

/** Por qué una respuesta no trae audio, para el log. */
function motivoSinAudio(data) {
    const fin = data?.candidates?.[0]?.finishReason ?? data?.status ?? data?.steps?.at?.(-1)?.status ?? "?";
    const bloqueo = data?.promptFeedback?.blockReason ?? "no";
    return `fin=${fin}, bloqueo=${bloqueo}`;
}

/** WAV a partir del audio recibido: si ya es WAV se usa tal cual; si es PCM crudo, con su frecuencia (rate=…). */
function aWav(buffer, mime = "") {
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return buffer;
    const rate = Number(/rate=(\d+)/i.exec(mime)?.[1]) || GEMINI_TTS_SAMPLE_RATE;
    return pcmToWav(buffer, rate);
}

class ErrorTts extends Error {
    constructor(mensaje, { siguienteModelo = false, fatal = false } = {}) {
        super(mensaje);
        this.siguienteModelo = siguienteModelo; // este modelo no sirve: pasar al siguiente sin reintentar
        this.fatal = fatal; // ninguno va a funcionar (clave mala...): no seguir probando
    }
}

/** Un intento con un modelo. Devuelve el WAV o lanza ErrorTts. */
async function intentar(modelo, texto, voz, key, limiteMs) {
    const { url, body } = peticion(modelo, texto, voz);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limiteMs);
    const t0 = Date.now();
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (controller.signal.aborted) throw new ErrorTts(`${modelo}: sin respuesta en ${limiteMs} ms`);
        const causa = e?.cause?.code ? ` (${e.cause.code})` : "";
        throw new ErrorTts(`${modelo}: no se pudo conectar${causa}: ${e.message}`);
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const texto = (await response.text().catch(() => "")).slice(0, 300);
        const s = response.status;
        // 401/403: clave mala o sin permiso (salvo un modelo concreto sin acceso, que dice "model"): no hay nada que hacer.
        const fatal = (s === 401 || s === 403) && !/model/i.test(texto);
        throw new ErrorTts(`${modelo}: HTTP ${s}${texto ? ` - ${texto}` : ""}`, { siguienteModelo: !fatal, fatal });
    }
    const data = await response.json().catch(() => null);
    const audio = data && extraerAudio(data);
    if (!audio) throw new ErrorTts(`${modelo}: respuesta sin audio (${motivoSinAudio(data)})`);
    const wav = aWav(Buffer.from(audio.base64, "base64"), audio.mime);
    log.debug(
        `Audio sintetizado con ${modelo}: ${texto.length} caracteres, voz ${voz}, ${Date.now() - t0} ms, ${(wav.length / 1024).toFixed(0)} KB`,
    );
    return wav;
}

/**
 * Modelos en el orden en que se prueban: el que funcionó la última vez, el configurado, el de por defecto (por si el
 * configurado en el .env es uno retirado, como gemini-2.5-flash-preview-tts) y los de respaldo.
 */
function modelosAProbar(modelo) {
    return [...new Set([modeloQueFunciona, modelo || GEMINI_TTS_MODEL, MODELO_POR_DEFECTO, ...GEMINI_TTS_FALLBACK_MODELS].filter(Boolean))];
}

/**
 * Sintetiza `text` con la voz `voice` y devuelve un WAV (Buffer). Prueba los modelos en orden (con un reintento si uno
 * responde sin audio) y, si ninguno puede, lanza un error con lo que le pasó a cada uno.
 */
async function synthesizeSpeech(text, { voice, model, apiKey, timeoutMs } = {}) {
    const key = apiKey || GEMINI_API_KEY;
    if (!key) throw new Error("Falta GOOGLE_API_KEY en variables de entorno");
    const texto = String(text || "").trim();
    if (!texto) throw new Error("Texto vacío para Gemini TTS");
    const voz = voice || GEMINI_TTS_VOICE;
    const t0 = Date.now();
    const fallos = [];

    for (const modelo of modelosAProbar(model)) {
        for (let intento = 1; intento <= INTENTOS_POR_MODELO; intento++) {
            const quedan = GEMINI_TTS_TOTAL_TIMEOUT_MS - (Date.now() - t0);
            if (quedan <= 0) break;
            try {
                const wav = await intentar(modelo, texto, voz, key, Math.min(timeoutMs || GEMINI_TTS_TIMEOUT_MS, quedan));
                if (modelo !== modeloQueFunciona) {
                    (fallos.length ? log.warn : log.info)(
                        `Voz generada con ${modelo}${fallos.length ? ` después de fallar: ${fallos.join(" · ")}` : ""}`,
                    );
                }
                modeloQueFunciona = modelo;
                return wav;
            } catch (e) {
                if (!(e instanceof ErrorTts)) throw e;
                fallos.push(e.message);
                log.warn(`Intento ${intento} de TTS fallido: ${e.message}`);
                if (e.fatal) throw new Error(`Gemini TTS no disponible: ${e.message}`);
                if (e.siguienteModelo) break;
            }
        }
        if (modelo === modeloQueFunciona) modeloQueFunciona = null;
    }
    throw new Error(`Gemini TTS no generó audio (${fallos.join(" · ") || "sin tiempo para intentarlo"})`);
}

async function getGeminiTtsAudioStream(text, opts = {}) {
    const wavBuffer = await synthesizeSpeech(text, opts);
    return Readable.from(wavBuffer);
}

module.exports = {
    getGeminiTtsAudioStream,
    synthesizeSpeech,
    pcmToWav,
    extraerAudio,
    aWav,
    GEMINI_TTS_VOICE,
    GEMINI_TTS_MODEL,
    /** El último modelo con el que se generó voz (o null). */
    modeloActual: () => modeloQueFunciona,
    // Para tests: olvidar el modelo que funcionó.
    __test: {
        reiniciar: () => {
            modeloQueFunciona = null;
        },
    },
};
