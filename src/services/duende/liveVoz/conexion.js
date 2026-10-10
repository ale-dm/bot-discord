// Conexión de voz en directo: unirse al canal, la salida de audio, la sesión con Gemini Live y el saludo inicial.

const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    StreamType,
} = require("@discordjs/voice");
const prism = require("prism-media");
const { Modality } = require("@google/genai");
const { getGenAI } = require("../../geminiClient");
const { LIVE_MODEL, LIVE_VOICE } = require("./constantes");
const { marcarActividad } = require("./sesion");
const { procesarLlamadas, reenviarAudioSalida, procesarTranscripciones } = require("./mensajes");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

async function conectarVoz(interaction, voiceChannel) {
    const guildId = interaction.guildId;
    let connection = getVoiceConnection(guildId);
    if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        if (connection) {
            try {
                connection.destroy();
            } catch {
                /* ya estaba muerta */
            }
        }
        log.info(`Uniéndose al canal de voz ${voiceChannel.name} (${guildId})...`);
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        log.info(`Conexión de voz lista en ${voiceChannel.name}.`);
    }
    connection.on("stateChange", (oldS, newS) => log.debug(`Voz: estado de conexión ${oldS.status} -> ${newS.status}`));
    connection.on("error", (e) => log.warn(`Error en la conexión de voz: ${e.message}`));
    return connection;
}

/**
 * Salida: un ffmpeg para toda la llamada, del PCM 24kHz mono que manda Gemini al
 * 48kHz estéreo que espera @discordjs/voice en crudo (StreamType.Raw). prism-media
 * añade "pipe:1" él solo al final de args (ver su FFmpeg.create): ponerlo aquí también
 * lo duplicaba y rompía el comando.
 */
function conectarSalida(connection, sesion) {
    const ffmpegArgs = ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2"];
    log.debug(`Lanzando ffmpeg para la salida de voz en directo: ${ffmpegArgs.join(" ")}`);
    const ffmpeg = new prism.FFmpeg({ args: ffmpegArgs });
    ffmpeg.on("error", (e) => log.warn(`Error en ffmpeg (salida de voz en directo): ${e.message}`));
    let bytesSalidaFfmpeg = 0;
    ffmpeg.on("data", (chunk) => {
        bytesSalidaFfmpeg += chunk.length;
        if (bytesSalidaFfmpeg === chunk.length) {
            log.info(`ffmpeg ha generado los primeros ${chunk.length} bytes de audio (ya convertidos a 48kHz estéreo).`);
        }
    });
    sesion.ffmpeg = ffmpeg;
    // maxMissedFrames por defecto es 5 (100ms sin datos) y da la conversación por acabada,
    // destruyendo el stream — letal aquí: entre turnos es normal que Gemini no mande audio
    // durante segundos (esperando a que hables). El corte de verdad lo hacen los timers de
    // inactividad/duración de más abajo, no el reproductor.
    const player = createAudioPlayer({ behaviors: { maxMissedFrames: Infinity } });
    player.on("error", (e) => log.warn(`Error en el reproductor de voz en directo: ${e.message}`));
    player.on("stateChange", (oldS, newS) => log.info(`Reproductor de voz en directo: ${oldS.status} -> ${newS.status}`));
    const resource = createAudioResource(ffmpeg, { inputType: StreamType.Raw, inlineVolume: true });
    const subscription = connection.subscribe(player);
    log.debug(`connection.subscribe(player) -> ${subscription ? "ok" : "undefined (¿la conexión no estaba lista?)"}`);
    player.play(resource);
}

/** Abre la sesión de Gemini Live (herramientas y callbacks incluidos) y la devuelve. */
async function conectarGemini(interaction, voiceChannel, sesion, { systemInstruction, declaraciones, toolContext }) {
    const guildId = interaction.guildId;
    const genAI = getGenAI();
    const liveSession = await genAI.live.connect({
        model: LIVE_MODEL,
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction,
            tools: [{ functionDeclarations: declaraciones }],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Desactivamos la detección de actividad automática de Gemini (basada en
            // silencios dentro del propio audio) y avisamos nosotros con activityStart/End:
            // Discord no manda paquetes de audio durante los silencios (no hay "silencio
            // codificado" que analizar), así que Gemini nunca veía el final del turno y se
            // quedaba esperando audio para siempre tras la primera frase del usuario. El
            // "speaking start/end" de Discord (basado en paquetes de verdad) es una señal
            // de turno mucho más fiable que intentar que Gemini la adivine del audio.
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
        callbacks: {
            onopen: () => log.info(`Conversación en directo abierta en ${voiceChannel.name} (${interaction.guild.name})`),
            onmessage: (message) => {
                marcarActividad(sesion);
                log.debug(`Mensaje de Gemini Live: ${Object.keys(message).join(", ") || "(vacío)"}`);
                if (message.toolCall) procesarLlamadas(liveSession, message.toolCall, { guildId, toolContext });
                // Si el audio se descarta, no se procesan las transcripciones de este mensaje (como antes).
                if (message.data && !reenviarAudioSalida(message.data, sesion)) return;
                procesarTranscripciones(message, sesion);
            },
            onerror: (e) => log.warn(`Error en la conversación en directo: ${e?.message || JSON.stringify(e)}`),
            onclose: (e) =>
                log.warn(
                    `Conversación en directo cerrada (socket) en el servidor ${guildId}${e ? `: ${e.reason || e.code || JSON.stringify(e)}` : ""}`,
                ),
        },
    });
    return liveSession;
}

/**
 * Saludo inicial: además de quedar más natural, confirma que la salida de audio
 * funciona nada más conectar, sin esperar a que alguien hable primero.
 */
function saludar(liveSession) {
    try {
        liveSession.sendClientContent({
            turns: "Acabas de entrar a una llamada de voz en directo. Saluda muy brevemente, en tu personalidad.",
            turnComplete: true,
        });
    } catch (e) {
        log.warn(`Error pidiendo el saludo inicial: ${e.message}`);
    }
}

/**
 * Suscribe la captura de audio de una persona y pasa cada trozo PCM (16kHz mono) a alTrozo.
 * EndBehaviorType.Manual no corta sola, así que una sola suscripción por persona vale para toda la llamada.
 */

module.exports = { conectarVoz, conectarSalida, conectarGemini, saludar };
