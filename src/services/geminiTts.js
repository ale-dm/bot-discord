const { Readable } = require("stream");
const { createLogger } = require("../core/logger");

const log = createLogger("TTS");

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_TIMEOUT_MS = Number(process.env.GEMINI_TTS_TIMEOUT_MS || 20000);
const GEMINI_TTS_SAMPLE_RATE = 24000;

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

async function synthesizeSpeech(text, { voice, model, apiKey, timeoutMs } = {}) {
    const key = apiKey || GEMINI_API_KEY;
    if (!key) throw new Error("Falta GOOGLE_API_KEY en variables de entorno");

    const trimmedText = String(text || "").trim();
    if (!trimmedText) throw new Error("Texto vacío para Gemini TTS");

    const mdl = model || GEMINI_TTS_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent`;

    const controller = new AbortController();
    const limitMs = timeoutMs || GEMINI_TTS_TIMEOUT_MS;
    const timeout = controller ? setTimeout(() => controller.abort(), limitMs) : null;
    const t0 = Date.now();
    const voz = voice || GEMINI_TTS_VOICE;

    try {
        let response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": key,
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: `TTS. Lee en voz alta, tal cual y sin añadir ni comentar nada, exactamente esta transcripcion: "${trimmedText}"`,
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: voz },
                            },
                        },
                    },
                }),
                signal: controller ? controller.signal : undefined,
            });
        } catch (networkErr) {
            const causeCode = networkErr?.cause?.code ? ` (${networkErr.cause.code})` : "";
            if (controller?.signal.aborted) {
                log.warn(`Síntesis cancelada por timeout (${limitMs} ms) · ${trimmedText.length} caracteres`);
                throw new Error(`Gemini TTS timeout tras ${limitMs}ms`);
            }
            log.warn(`Sin conexión con Gemini TTS${causeCode} tras ${Date.now() - t0} ms: ${networkErr.message}`);
            throw new Error(`No se pudo conectar con Gemini TTS${causeCode}: ${networkErr.message}`);
        }

        if (!response.ok) {
            const bodyText = await response.text().catch(() => "");
            log.warn(`Gemini TTS respondió HTTP ${response.status} en ${Date.now() - t0} ms: ${bodyText.slice(0, 300)}`);
            throw new Error(`Gemini TTS HTTP ${response.status}${bodyText ? ` - ${bodyText.slice(0, 300)}` : ""}`);
        }

        const data = await response.json();
        const base64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64) {
            log.warn(
                `Respuesta sin audio (fin=${data?.candidates?.[0]?.finishReason ?? "?"}, bloqueo=${data?.promptFeedback?.blockReason ?? "no"})`,
            );
            throw new Error("Respuesta de audio vacía de Gemini TTS");
        }

        const pcm = Buffer.from(base64, "base64");
        log.debug(
            `Audio sintetizado: ${trimmedText.length} caracteres, voz ${voz}, ${mdl}, ${Date.now() - t0} ms, ${(pcm.length / 1024).toFixed(0)} KB`,
        );
        return pcmToWav(pcm);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

const GEMINI_TTS_VOICE = process.env.DUENDE_TTS_VOICE || "Puck";

async function getGeminiTtsAudioStream(text, opts = {}) {
    const wavBuffer = await synthesizeSpeech(text, opts);
    return Readable.from(wavBuffer);
}

module.exports = {
    getGeminiTtsAudioStream,
    synthesizeSpeech,
    pcmToWav,
    GEMINI_TTS_VOICE,
};
