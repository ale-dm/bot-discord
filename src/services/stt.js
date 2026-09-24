// Speech-to-Text para Discord: graba la siguiente intervención de un usuario en un canal
// de voz y la transcribe con el servidor Vosk local (vosk/server.py).
const { joinVoiceChannel, EndBehaviorType, getVoiceConnection } = require("@discordjs/voice");
const fs = require("fs");
const os = require("os");
const path = require("path");
const prism = require("prism-media");
const axios = require("axios");
const FormData = require("form-data");
const { createLogger } = require("../core/logger");
const { LOGS_DIR } = require("../core/paths");

const log = createLogger("STT");

const STT_FIXED_USER_ID = String(process.env.STT_FIXED_USER_ID || "").trim();
const LOCAL_STT_URL = process.env.LOCAL_STT_URL || "http://127.0.0.1:5001/transcribe";
// Grabaciones que no se pudieron transcribir: se guardan para poder revisarlas.
const FAILED_WAVS_DIR = path.join(LOGS_DIR, "stt_failed_wavs");

// Añade una cabecera WAV (RIFF) a un fichero PCM 16-bit mono, en streaming.
async function pcmToWav(pcmPath, wavPath, opts = { channels: 1, sampleRate: 16000, bytesPerSample: 2 }) {
    const dataSize = fs.statSync(pcmPath).size;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(opts.channels, 22);
    header.writeUInt32LE(opts.sampleRate, 24);
    header.writeUInt32LE(opts.sampleRate * opts.channels * opts.bytesPerSample, 28);
    header.writeUInt16LE(opts.channels * opts.bytesPerSample, 32);
    header.writeUInt16LE(opts.bytesPerSample * 8, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return new Promise((resolve, reject) => {
        const rs = fs.createReadStream(pcmPath);
        const ws = fs.createWriteStream(wavPath);
        ws.on("error", reject);
        rs.on("error", reject);
        ws.write(header);
        rs.pipe(ws);
        ws.on("finish", resolve);
    });
}

// Envía el WAV al servidor Vosk local y devuelve el texto (o null).
async function transcribeWithLocalServer(filename) {
    if (!fs.existsSync(filename)) return null;
    const t0 = Date.now();
    try {
        const data = new FormData();
        data.append("file", fs.createReadStream(filename));
        const res = await axios.post(LOCAL_STT_URL, data, {
            headers: { ...data.getHeaders() },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 30000,
            validateStatus: () => true,
        });
        if (res.status >= 200 && res.status < 300 && typeof res.data?.text === "string") {
            log.debug(`Vosk transcribió en ${Date.now() - t0} ms: "${res.data.text}"`);
            return res.data.text;
        }
        log.warn(`Vosk respondió ${res.status} (${Date.now() - t0} ms): ${JSON.stringify(res.data)}`);
        return null;
    } catch (e) {
        log.warn(`Servidor Vosk no disponible en ${LOCAL_STT_URL}: ${e.code || ""} ${e.message}`);
        return null;
    }
}

function removeQuietly(file) {
    try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
        log.warn(`No se pudo borrar el temporal ${file}: ${e.message}`);
    }
}

// Guarda un WAV que no se pudo transcribir para revisarlo después (solo en local).
function keepFailedWav(wavFile) {
    try {
        fs.mkdirSync(FAILED_WAVS_DIR, { recursive: true });
        const dest = path.join(FAILED_WAVS_DIR, `${Date.now()}_${path.basename(wavFile)}`);
        fs.renameSync(wavFile, dest);
        log.info(`Audio sin transcripción guardado en ${dest}`);
    } catch (e) {
        log.warn(`No se pudo guardar el audio fallido: ${e.message}`);
        removeQuietly(wavFile);
    }
}

/**
 * Escucha la próxima intervención de un usuario en un canal de voz, la transcribe y
 * llama a callback(transcript, { client, guild, channel, user, member }).
 * La escucha es de un solo uso: se desengancha al detectar al usuario o al vencer el timeout.
 */
async function listenAndTranscribe(client, guildId, channelId, invokingUserId, callback, opts = {}) {
    let connection = getVoiceConnection(guildId);
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!connection) {
        log.debug(`Uniéndose al canal de voz ${channel.name}`);
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
        });
    }

    const receiver = connection.receiver;
    const onlyListenUser = String(process.env.STT_ONLY_USER_ID || STT_FIXED_USER_ID || invokingUserId || "").trim();
    log.debug(`Esperando la próxima intervención de ${onlyListenUser || "(cualquiera)"}`);

    // Escucha de un solo uso: invocar /escuchar varias veces seguidas no debe ir
    // acumulando listeners duplicados sobre la misma conexión de voz.
    const timeoutMs = Number(opts.timeoutMs ?? process.env.STT_LISTEN_TIMEOUT_MS ?? 5 * 60 * 1000);
    let timeoutHandle = null;
    const detach = () => {
        receiver.speaking.removeListener("start", onSpeakingStart);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
    };
    timeoutHandle = setTimeout(() => {
        log.debug(`Tiempo de espera agotado sin que hablara ${onlyListenUser || "(nadie)"}`);
        detach();
    }, timeoutMs);

    function onSpeakingStart(userIdSpeaking) {
        if (onlyListenUser && userIdSpeaking !== onlyListenUser) return;
        const maybeMember = guild.members.cache.get(userIdSpeaking);
        if (maybeMember?.user?.bot) return;
        detach();

        if (!receiver._recordingUsers) receiver._recordingUsers = {};
        if (receiver._recordingUsers[userIdSpeaking]) {
            log.debug(`Ya se está grabando a ${userIdSpeaking}, se ignora`);
            return;
        }
        receiver._recordingUsers[userIdSpeaking] = true;
        log.debug(`${userIdSpeaking} empieza a hablar`);

        const opusStream = receiver.subscribe(userIdSpeaking, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 1800 }, // 1,8 s de silencio corta
        });
        const pcmStream = opusStream.pipe(new prism.opus.Decoder({ channels: 1, rate: 16000, frameSize: 320 }));
        // Temporales en la carpeta del sistema, no en la raíz del proyecto.
        const pcmFile = path.join(os.tmpdir(), `duende_audio_${userIdSpeaking}_${Date.now()}.pcm`);
        const wavFile = pcmFile.replace(/\.pcm$/, ".wav");
        const out = fs.createWriteStream(pcmFile);
        pcmStream.pipe(out);

        // Cierre forzado a los 15 s por si el silencio no llega a detectarse.
        const forceClose = setTimeout(() => {
            if (!out.closed) out.end();
        }, 15000);

        out.on("finish", async () => {
            clearTimeout(forceClose);
            let transcript = null;
            try {
                await pcmToWav(pcmFile, wavFile);
                transcript = await transcribeWithLocalServer(wavFile);

                let member = null;
                let user = { id: userIdSpeaking };
                try {
                    member = await guild.members.fetch(userIdSpeaking);
                    user = member.user;
                } catch (e) {
                    log.warn(`No se pudo obtener el miembro ${userIdSpeaking}: ${e.message}`);
                }

                try {
                    await callback(transcript, { client, guild, channel, user, member });
                } catch (cbErr) {
                    log.error("Error procesando la transcripción:", cbErr);
                }
            } catch (err) {
                log.error("Error procesando el audio grabado:", err);
            } finally {
                removeQuietly(pcmFile);
                if (fs.existsSync(wavFile)) {
                    if (transcript) removeQuietly(wavFile);
                    else keepFailedWav(wavFile);
                }
                delete receiver._recordingUsers[userIdSpeaking];
            }
        });
    }

    receiver.speaking.on("start", onSpeakingStart);
}

module.exports = { listenAndTranscribe };
