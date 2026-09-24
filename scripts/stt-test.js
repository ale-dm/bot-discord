// Prueba el servidor Vosk local con un WAV: muestra el formato del audio y la transcripción.
// Uso: node scripts/stt-test.js ruta/al/audio.wav
// (los audios que el bot no pudo transcribir se guardan en logs/stt_failed_wavs)
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
    console.error("Uso: node scripts/stt-test.js ruta/al/audio.wav");
    process.exit(1);
}

function describeWav(buf) {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return "no es un WAV válido";
    const channels = buf.readUInt16LE(22);
    const rate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28);
    const bits = buf.readUInt16LE(34);
    let pos = 20 + buf.readUInt32LE(16);
    let data = null;
    while (pos + 8 <= buf.length) {
        const id = buf.toString("ascii", pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        if (id === "data") {
            data = { pos: pos + 8, size };
            break;
        }
        pos += 8 + size;
    }
    if (!data) return `${channels} canal(es), ${rate} Hz, ${bits} bits, sin bloque de datos`;
    let sum = 0;
    let n = 0;
    for (let i = data.pos; i + 1 < data.pos + data.size && i + 1 < buf.length; i += 2) {
        const s = buf.readInt16LE(i);
        sum += s * s;
        n++;
    }
    const rms = Math.round(Math.sqrt(sum / Math.max(1, n)));
    return `${channels} canal(es), ${rate} Hz, ${bits} bits, ${(data.size / byteRate).toFixed(2)} s, volumen RMS ${rms}`;
}

(async () => {
    console.log("Audio:", describeWav(fs.readFileSync(file)));
    const url = process.env.LOCAL_STT_URL || "http://127.0.0.1:5001/transcribe";
    const form = new FormData();
    form.append("file", fs.createReadStream(file));
    try {
        const res = await axios.post(url, form, {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            validateStatus: () => true,
        });
        console.log(`Vosk (${url}) → HTTP ${res.status}:`, res.data);
    } catch (e) {
        console.error(`No se pudo conectar con ${url}: ${e.message}`);
        process.exit(1);
    }
})();
