// 🎙️ Notas de voz del chat (#376): si alguien manda una nota de voz (o un audio corto) en un canal donde responde el Duende, se
// transcribe con el reconocedor local de /escuchar (Vosk) y el Duende contesta al texto como si lo hubiera escrito la persona. El audio
// se descarga a un temporal, se convierte a WAV con ffmpeg y se borra al acabar: no se guarda nada. Hasta 60 segundos.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const prism = require("prism-media");
const { createLogger } = require("../core/logger");

const log = createLogger("NotaDeVoz");

const MAX_SEGUNDOS = 60;
const MAX_BYTES = 8 * 1024 * 1024;

/** ¿Es un adjunto de audio que se puede transcribir? (una nota de voz de Discord es audio/ogg). */
const esAudio = (adjunto) =>
    String(adjunto?.contentType || "")
        .toLowerCase()
        .startsWith("audio/");

/** Un audio demasiado largo o pesado no se transcribe. La duración (en segundos) solo la traen las notas de voz de Discord. */
const cabe = (adjunto) => !(Number(adjunto?.duration) > MAX_SEGUNDOS) && !(Number(adjunto?.size) > MAX_BYTES);

async function descargar(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} descargando el audio`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error("El audio pesa demasiado");
    return buffer;
}

/** Convierte cualquier audio a WAV de 16 kHz mono (lo que espera el reconocedor), con ffmpeg. */
function convertirAWav(entrada, salida) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(prism.FFmpeg.getInfo(true).command, ["-y", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", salida], {
            stdio: ["pipe", "ignore", "ignore"],
        });
        ffmpeg.on("error", reject);
        ffmpeg.on("close", (codigo) => (codigo === 0 ? resolve() : reject(new Error(`ffmpeg terminó con el código ${codigo}`))));
        ffmpeg.stdin.on("error", () => {});
        ffmpeg.stdin.end(entrada);
    });
}

const reales = {
    descargar,
    convertirAWav,
    transcribir: (wav) => require("./stt").transcribeWithLocalServer(wav),
};

/**
 * El texto de una nota de voz, o null si no se ha podido (el error se anota en el log y no se responde en el canal).
 * @param {{ url: string, duration?: number }} adjunto
 */
async function transcribirNota(adjunto, deps = reales) {
    const wav = path.join(os.tmpdir(), `nota_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    try {
        const audio = await deps.descargar(adjunto.url);
        await deps.convertirAWav(audio, wav);
        const texto = String((await deps.transcribir(wav)) || "").trim();
        if (!texto) log.warn("La nota de voz no ha dado ninguna transcripción");
        return texto || null;
    } catch (e) {
        log.warn(`No se pudo transcribir la nota de voz: ${e.message}`);
        return null;
    } finally {
        try {
            if (fs.existsSync(wav)) fs.unlinkSync(wav);
        } catch (e) {
            log.debug(`No se pudo borrar el temporal ${wav}: ${e.message}`);
        }
    }
}

module.exports = { MAX_SEGUNDOS, MAX_BYTES, esAudio, cabe, transcribirNota };
