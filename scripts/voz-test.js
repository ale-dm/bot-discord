// Prueba de la voz del bot de principio a fin, sin Discord: genera audio con Gemini TTS (con los mismos modelos y
// respaldos que el bot), comprueba que @discordjs/voice lo convierte en paquetes Opus (lo que se manda al canal) y, si
// el servidor Vosk está en marcha, lo transcribe otra vez para ver que se entiende. Con --duende, antes le pregunta al
// Duende (Gemini) y dice su respuesta.
// Uso: node scripts/voz-test.js ["texto a decir"] [--voz Kore] [--duende]
// Necesita GOOGLE_API_KEY en .env. Deja el audio en logs/voz-test.wav.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { spawnSync } = require("child_process");
const axios = require("axios");
const FormData = require("form-data");

process.env.LOG_CONSOLE_LEVEL = process.env.LOG_CONSOLE_LEVEL || "info";
const { LOGS_DIR } = require("../src/core/paths");
const tts = require("../src/services/geminiTts");

const args = process.argv.slice(2);
const opcion = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const conDuende = args.includes("--duende");
const texto = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--voz") || "Hola, soy el Duende. Si me oyes, la voz funciona.";
const voz = opcion("--voz") || tts.GEMINI_TTS_VOICE;
const ok = (m) => console.log(`✓ ${m}`);
const mal = (m) => {
    console.log(`✗ ${m}`);
    process.exitCode = 1;
};

function describirWav(buf) {
    if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
    const rate = buf.readUInt32LE(24);
    const canales = buf.readUInt16LE(22);
    const bits = buf.readUInt16LE(34);
    const datos = buf.length - 44;
    return { rate, canales, bits, segundos: datos / (rate * canales * (bits / 8)) };
}

async function paquetesOpus(wav) {
    const { createAudioResource, StreamType } = require("@discordjs/voice");
    const recurso = createAudioResource(Readable.from(wav), { inputType: StreamType.Arbitrary });
    return new Promise((resolve, reject) => {
        let n = 0;
        recurso.playStream.on("data", () => n++);
        recurso.playStream.on("end", () => resolve(n));
        recurso.playStream.on("error", reject);
    });
}

async function transcribir(wav) {
    const url = process.env.LOCAL_STT_URL || "http://127.0.0.1:5001/transcribe";
    // Vosk quiere WAV mono a 16 kHz, como el que graba el bot.
    const ffmpeg = require("prism-media").FFmpeg.getInfo().command;
    const entrada = path.join(LOGS_DIR, "voz-test.wav");
    const salida = path.join(LOGS_DIR, "voz-test-16k.wav");
    const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", entrada, "-ac", "1", "-ar", "16000", salida]);
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    const form = new FormData();
    form.append("file", fs.createReadStream(salida));
    const res = await axios.post(url, form, { headers: form.getHeaders(), timeout: 30000, validateStatus: () => true });
    if (res.status !== 200) throw new Error(`Vosk HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    return res.data.text;
}

(async () => {
    if (!process.env.GOOGLE_API_KEY) {
        mal("Falta GOOGLE_API_KEY en .env");
        return;
    }
    let frase = texto;
    if (conDuende) {
        const { generarConGemini } = require("../src/services/duende/gemini");
        const t0 = Date.now();
        frase = await generarConGemini([`Eres el Duende, un bot gamberro. Responde en una frase corta a: ${texto}`], { maxTokens: 200 });
        ok(`El Duende responde (${Date.now() - t0} ms): "${frase}"`);
    }

    console.log(`TTS: modelo ${tts.GEMINI_TTS_MODEL} (y respaldos), voz ${voz}`);
    const t0 = Date.now();
    let wav;
    try {
        wav = await tts.synthesizeSpeech(frase, { voice: voz });
    } catch (e) {
        mal(`TTS: ${e.message}`);
        return;
    }
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOGS_DIR, "voz-test.wav"), wav);
    const info = describirWav(wav);
    if (!info || info.segundos < 0.3) mal(`El audio no es un WAV válido o está vacío (${JSON.stringify(info)})`);
    else ok(`Audio: ${info.segundos.toFixed(1)} s, ${info.rate} Hz, ${info.canales} canal, ${Date.now() - t0} ms (logs/voz-test.wav)`);

    const n = await paquetesOpus(wav);
    if (n < info.segundos * 40) mal(`Solo ${n} paquetes Opus para ${info.segundos.toFixed(1)} s de audio`);
    else ok(`Discord lo puede reproducir: ${n} paquetes Opus (~${(n / 50).toFixed(1)} s)`);

    try {
        const oido = await transcribir(wav);
        (oido ? ok : mal)(`Vosk lo entiende como: "${oido}"`);
    } catch (e) {
        console.log(`· Sin comprobación con Vosk (${e.message}). Arráncalo con: npm run start:vosk`);
    }
})();
