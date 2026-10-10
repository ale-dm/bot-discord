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
const { LIVE_MODEL, LIVE_VOICE, PALABRA_LLAMADA } = require("./constantes");
const { pararConversacion, marcarActividad } = require("./sesion");
const { responderLlamadasHerramientas } = require("./declaraciones");
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
                if (message.toolCall) {
                    const llamadas = message.toolCall.functionCalls || [];
                    const colgar = llamadas.find((fc) => fc.name === "colgar_llamada");
                    if (colgar) {
                        liveSession.sendToolResponse({
                            functionResponses: [{ id: colgar.id, name: colgar.name, response: { ok: true } }],
                        });
                        log.info(`Colgando la llamada en el servidor ${guildId}: pedido por voz.`);
                        pararConversacion(guildId, "pedido por voz");
                    }
                    const resto = llamadas.filter((fc) => fc.name !== "colgar_llamada");
                    if (resto.length) {
                        responderLlamadasHerramientas(liveSession, { ...message.toolCall, functionCalls: resto }, toolContext).catch((e) =>
                            log.warn(`Error respondiendo herramientas en voz en directo: ${e.message}`),
                        );
                    }
                }
                if (message.data) {
                    const buf = Buffer.from(message.data, "base64");
                    if (!sesion.permitirAudioSalida) {
                        if (!sesion.avisoIgnoradoEsteTurno) {
                            sesion.avisoIgnoradoEsteTurno = true;
                            log.debug(`Se ignora la respuesta de Gemini: no le han dicho "duende" en este turno (modo solo si le llaman).`);
                        }
                        return;
                    }
                    sesion.chunksAudioSalida = (sesion.chunksAudioSalida || 0) + 1;
                    if (sesion.chunksAudioSalida === 1) {
                        log.info(`Primer trozo de audio de Gemini recibido (${buf.length} bytes) — pasándolo a ffmpeg.`);
                    }
                    try {
                        // La clase FFmpeg de prism-media pone write/end directamente en la
                        // instancia (copiados del stdin interno): no existe .stdin.
                        sesion.ffmpeg.write(buf);
                    } catch (e) {
                        log.warn(`Error pasando el audio de Gemini a ffmpeg: ${e.message}`);
                    }
                }
                if (message.serverContent?.outputTranscription?.text) {
                    log.debug(`Duende (voz en directo): ${message.serverContent.outputTranscription.text}`);
                }
                if (message.serverContent?.inputTranscription?.text) {
                    const texto = message.serverContent.inputTranscription.text;
                    log.debug(`Usuario (voz en directo): ${texto}`);
                    sesion.turnoTranscripcion += texto;
                    // En cuanto se oye la palabra de llamada en este turno, se deja pasar la
                    // respuesta — no hace falta esperar a que acabe de hablar para decidirlo.
                    if (sesion.soloSiLeLlaman && PALABRA_LLAMADA.test(sesion.turnoTranscripcion)) {
                        sesion.permitirAudioSalida = true;
                    }
                }
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
