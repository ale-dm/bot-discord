// Conversación por voz en directo con el Duende (Gemini Live API): audio bidireccional real,
// no por turnos como /escuchar (Vosk + TTS por lotes, que sigue igual y sin tocar — esto es
// una funcionalidad nueva y aparte, /conversación).
//
// El coste por minuto es bajo (~$0,005/min entrada + $0,018/min salida), pero se cobra
// mientras la conexión esté abierta, no solo cuando alguien habla — por eso hay un corte por
// inactividad y un tope de duración, los dos obligatorios, no opcionales.
const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    StreamType,
    EndBehaviorType,
} = require("@discordjs/voice");
const prism = require("prism-media");
const { Modality } = require("@google/genai");
const { getGenAI } = require("../geminiClient");
const { createLogger } = require("../../core/logger");
const perfiles = require("../../systems/duende/perfiles");
const tautulliClient = require("../tautulliClient");
const seerrClient = require("../seerrClient");
const {
    DUENDE_CORE_TOOL_DECLARATIONS,
    DUENDE_PLEX_TOOL_DECLARATIONS,
    DUENDE_SEERR_TOOL_DECLARATIONS,
    DUENDE_TOOL_EXECUTORS,
} = require("./herramientas");
const { GEMINI_TTS_VOICE } = require("../geminiTts");

const log = createLogger("Duende").child("VozEnVivo");

const LIVE_MODEL = process.env.DUENDE_LIVE_MODEL || "gemini-3.8-live";
const LIVE_VOICE = process.env.DUENDE_LIVE_VOICE || process.env.DUENDE_TTS_VOICE || GEMINI_TTS_VOICE;
// Se cobra mientras la conexión esté abierta, no solo cuando se habla: sin esto, dejarse la
// llamada olvidada puede salir caro. No es opcional.
const IDLE_DISCONNECT_MS = Number(process.env.DUENDE_LIVE_IDLE_DISCONNECT_MS || 5 * 60 * 1000);
// Tope duro, pase lo que pase, por si algo falla y la sesión se queda colgada sin más.
const MAX_DURATION_MS = Number(process.env.DUENDE_LIVE_MAX_DURATION_MS || 30 * 60 * 1000);
const IDLE_CHECK_INTERVAL_MS = 15_000;

// guildId -> sesión en curso. Una conversación en directo a la vez por servidor.
const sesiones = new Map();

function hayConversacionActiva(guildId) {
    return sesiones.has(guildId);
}

// Mismas herramientas que el chat de texto (services/duende/gemini.js), con la misma regla de
// qué Plex/Seerr se permite según el canal de TEXTO desde donde se pide /conversación (el de voz
// no tiene lista de permitidos propia).
function construirDeclaracionesHerramientas(guildId, channelId) {
    const hasChannelCtx = guildId && channelId;
    const plexAllowed = hasChannelCtx && tautulliClient.isChannelAllowed(guildId, channelId);
    const seerrAllowed = hasChannelCtx && seerrClient.isChannelAllowed(guildId, channelId);
    return [
        ...DUENDE_CORE_TOOL_DECLARATIONS,
        ...(plexAllowed ? DUENDE_PLEX_TOOL_DECLARATIONS : []),
        ...(seerrAllowed ? DUENDE_SEERR_TOOL_DECLARATIONS : []),
    ];
}

// A diferencia del chat de texto (duende.js), la sesión de Gemini Live solo acepta un
// systemInstruction fijo al conectar, no uno distinto por mensaje: se construye una vez aquí.
function construirInstruccionesSistema(channelId) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    return (
        `${base} Esto es una conversación de voz en directo, no texto escrito: responde corto y de forma natural, ` +
        "como hablarías en persona, sin markdown ni listas. Si tienes herramientas disponibles que te den datos " +
        "reales (nivel, saldo, Plex...), úsalas siempre antes de contestar, sea cual sea tu personalidad; no te " +
        "niegues a mirar ni digas que no puedes saberlo si hay una herramienta que sí puede."
    );
}

/** Ejecuta las llamadas a herramientas que pide Gemini Live y le manda el resultado. Exportada para poder probarla sin un socket real. */
async function responderLlamadasHerramientas(liveSession, toolCall, toolContext) {
    const functionResponses = await Promise.all(
        (toolCall.functionCalls || []).map(async (fc) => {
            let result;
            try {
                const executor = DUENDE_TOOL_EXECUTORS[fc.name];
                result = executor ? await executor(fc.args, toolContext) : { error: "Herramienta desconocida." };
            } catch (err) {
                log.warn(`Error ejecutando herramienta ${fc.name}: ` + (err && err.message));
                result = { error: "No se pudo obtener el dato." };
            }
            log.info(`Herramienta usada en voz en directo: ${fc.name}(${JSON.stringify(fc.args || {})}) -> ${JSON.stringify(result)}`);
            return { id: fc.id, name: fc.name, response: result };
        }),
    );
    liveSession.sendToolResponse({ functionResponses });
}

function limpiarSesion(sesion) {
    clearInterval(sesion.idleCheckInterval);
    clearTimeout(sesion.maxDurationTimer);
    try {
        if (sesion.receiver && sesion.onSpeakingStart) sesion.receiver.speaking.removeListener("start", sesion.onSpeakingStart);
        if (sesion.receiver && sesion.onSpeakingEnd) sesion.receiver.speaking.removeListener("end", sesion.onSpeakingEnd);
    } catch (e) {
        log.debug(`Error quitando el listener de voz: ${e.message}`);
    }
    try {
        sesion.opusStream?.destroy();
    } catch (e) {
        log.debug(`Error cerrando la entrada de audio: ${e.message}`);
    }
    try {
        sesion.ffmpeg?.destroy();
    } catch (e) {
        log.debug(`Error cerrando ffmpeg: ${e.message}`);
    }
    try {
        sesion.liveSession?.close();
    } catch (e) {
        log.debug(`Error cerrando la sesión de Gemini Live: ${e.message}`);
    }
    try {
        sesion.connection?.destroy();
    } catch (e) {
        log.debug(`Error cerrando la conexión de voz: ${e.message}`);
    }
}

/** @returns {boolean} true si había una conversación y se ha terminado */
function pararConversacion(guildId, motivo) {
    const sesion = sesiones.get(guildId);
    if (!sesion) return false;
    sesiones.delete(guildId);
    limpiarSesion(sesion);
    log.info(`Conversación en directo terminada en el servidor ${guildId}${motivo ? ` (${motivo})` : ""}`);
    sesion.onTerminada?.(motivo);
    return true;
}

/**
 * Empieza una conversación de voz en directo en el canal de quien invoca.
 * @returns {Promise<{ok: true, voiceChannel: object} | {ok: false, error: string}>}
 */
async function empezarConversacion(interaction, { onTerminada } = {}) {
    const guildId = interaction.guildId;
    if (sesiones.has(guildId)) {
        return { ok: false, error: "Ya hay una conversación en directo en este servidor. Usa `/conversación` otra vez para terminarla." };
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return { ok: false, error: "¡Debes estar en un canal de voz!" };

    const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
        return { ok: false, error: "Me faltan permisos para conectar o hablar en ese canal." };
    }

    // El canal de TEXTO desde donde se pide, igual que con las herramientas del chat normal.
    const channelId = interaction.channelId;
    const toolContext = { guildId, userId: interaction.user.id, guild: interaction.guild, channelId };
    const declaraciones = construirDeclaracionesHerramientas(guildId, channelId);
    const systemInstruction = construirInstruccionesSistema(channelId);

    const sesion = { ultimaActividad: Date.now(), onTerminada };
    sesiones.set(guildId, sesion);

    try {
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
        sesion.connection = connection;

        // Salida: un ffmpeg para toda la llamada, del PCM 24kHz mono que manda Gemini al
        // 48kHz estéreo que espera @discordjs/voice en crudo (StreamType.Raw). prism-media
        // añade "pipe:1" él solo al final de args (ver su FFmpeg.create): ponerlo aquí también
        // lo duplicaba y rompía el comando.
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

        const marcarActividad = () => {
            sesion.ultimaActividad = Date.now();
        };

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
                    marcarActividad();
                    log.debug(`Mensaje de Gemini Live: ${Object.keys(message).join(", ") || "(vacío)"}`);
                    if (message.toolCall) {
                        responderLlamadasHerramientas(liveSession, message.toolCall, toolContext).catch((e) =>
                            log.warn(`Error respondiendo herramientas en voz en directo: ${e.message}`),
                        );
                    }
                    if (message.data) {
                        sesion.chunksAudioSalida = (sesion.chunksAudioSalida || 0) + 1;
                        const buf = Buffer.from(message.data, "base64");
                        if (sesion.chunksAudioSalida === 1) {
                            log.info(`Primer trozo de audio de Gemini recibido (${buf.length} bytes) — pasándolo a ffmpeg.`);
                        }
                        try {
                            // La clase FFmpeg de prism-media pone write/end directamente en la
                            // instancia (copiados del stdin interno): no existe .stdin.
                            ffmpeg.write(buf);
                        } catch (e) {
                            log.warn(`Error pasando el audio de Gemini a ffmpeg: ${e.message}`);
                        }
                    }
                    if (message.serverContent?.outputTranscription?.text) {
                        log.debug(`Duende (voz en directo): ${message.serverContent.outputTranscription.text}`);
                    }
                    if (message.serverContent?.inputTranscription?.text) {
                        log.debug(`Usuario (voz en directo): ${message.serverContent.inputTranscription.text}`);
                    }
                },
                onerror: (e) => log.warn(`Error en la conversación en directo: ${e?.message || JSON.stringify(e)}`),
                onclose: (e) =>
                    log.warn(
                        `Conversación en directo cerrada (socket) en el servidor ${guildId}${e ? `: ${e.reason || e.code || JSON.stringify(e)}` : ""}`,
                    ),
            },
        });
        sesion.liveSession = liveSession;
        log.info(`Sesión de Gemini Live conectada (modelo ${LIVE_MODEL}, voz ${LIVE_VOICE}).`);

        // Saludo inicial: además de quedar más natural, confirma que la salida de audio
        // funciona nada más conectar, sin esperar a que alguien hable primero.
        try {
            liveSession.sendClientContent({
                turns: "Acabas de entrar a una llamada de voz en directo. Saluda muy brevemente, en tu personalidad.",
                turnComplete: true,
            });
        } catch (e) {
            log.warn(`Error pidiendo el saludo inicial: ${e.message}`);
        }

        // Entrada: todo lo que diga quien ha pedido /conversación mientras dure la llamada. Se
        // suscribe reactivamente al primer "empieza a hablar" (igual que services/stt.js), no
        // al conectar: suscribirse antes de que Discord asocie el audio a este usuario no
        // captura nada (visto en producción: la sesión se abría pero nunca recibía tu voz).
        // EndBehaviorType.Manual no corta sola, así que una sola suscripción vale para toda la
        // llamada, aunque haya silencios entre frases.
        const receiver = connection.receiver;
        const targetUserId = interaction.user.id;
        let suscrito = false;
        // Con la detección automática desactivada, Gemini corta la sesión con "Precondition
        // check failed" si le llega audio FUERA de un activityStart/activityEnd — y eso pasa de
        // verdad: el "end" de Discord y el último trozo de audio decodificado no llegan
        // perfectamente a la vez (el decoder de Opus puede soltar algún trozo con el stream ya
        // "parado"). Esta bandera corta ese audio sobrante en vez de mandarlo de todos modos.
        let hablando = false;
        const onSpeakingStart = (userId) => {
            if (userId !== targetUserId) return;
            // Esto es lo que le dice a Gemini que empieza el turno del usuario — se manda cada
            // vez que habla, no solo la primera.
            hablando = true;
            try {
                liveSession.sendRealtimeInput({ activityStart: {} });
            } catch (e) {
                log.warn(`Error avisando a Gemini de que ${userId} ha empezado a hablar: ${e.message}`);
            }
            if (suscrito) return;
            suscrito = true;
            log.info(`${userId} ha empezado a hablar: suscribiendo captura de audio.`);
            const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
            opusStream.on("error", (e) => log.warn(`Error leyendo el audio entrante (opus) de ${userId}: ${e.message}`));
            sesion.opusStream = opusStream;
            const pcmStream = opusStream.pipe(new prism.opus.Decoder({ channels: 1, rate: 16000, frameSize: 320 }));
            pcmStream.on("error", (e) => log.warn(`Error decodificando el audio entrante de ${userId}: ${e.message}`));
            pcmStream.on("data", (chunk) => {
                marcarActividad();
                if (!hablando) return; // trozo sobrante fuera del activityStart/activityEnd: se descarta, no se manda
                sesion.chunksAudioEntrada = (sesion.chunksAudioEntrada || 0) + 1;
                if (sesion.chunksAudioEntrada === 1) {
                    log.info(`Primer trozo de audio de ${userId} capturado (${chunk.length} bytes) — mandándolo a Gemini.`);
                }
                try {
                    // El campo es "audio" (stream de audio en tiempo real de verdad), no el
                    // genérico "media" — con la detección manual de actividad puesta, el server
                    // necesita el audio por ese campo para poder casarlo con activityStart/End;
                    // por "media" llegaba igual pero sin ese seguimiento, y cortaba la sesión
                    // con "Precondition check failed" a los pocos segundos de hablar.
                    liveSession.sendRealtimeInput({ audio: { data: chunk.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
                } catch (e) {
                    log.warn(`Error enviando audio a Gemini Live: ${e.message}`);
                }
            });
        };
        // El "end" de Discord llega ~100ms después del último paquete de voz real — mucho más
        // fiable como señal de fin de turno que esperar a que Gemini la adivine de un audio con
        // huecos (sin paquetes durante los silencios, no hay "silencio" que analizar).
        const onSpeakingEnd = (userId) => {
            if (userId !== targetUserId) return;
            hablando = false;
            try {
                liveSession.sendRealtimeInput({ activityEnd: {} });
            } catch (e) {
                log.warn(`Error avisando a Gemini de que ${userId} ha dejado de hablar: ${e.message}`);
            }
        };
        receiver.speaking.on("start", onSpeakingStart);
        receiver.speaking.on("end", onSpeakingEnd);
        sesion.receiver = receiver;
        sesion.onSpeakingStart = onSpeakingStart;
        sesion.onSpeakingEnd = onSpeakingEnd;

        sesion.idleCheckInterval = setInterval(() => {
            if (Date.now() - sesion.ultimaActividad > IDLE_DISCONNECT_MS) {
                pararConversacion(guildId, `${Math.round(IDLE_DISCONNECT_MS / 60000)} min sin actividad`);
            }
        }, IDLE_CHECK_INTERVAL_MS);
        sesion.maxDurationTimer = setTimeout(() => {
            pararConversacion(guildId, `tope de ${Math.round(MAX_DURATION_MS / 60000)} min de duración`);
        }, MAX_DURATION_MS);

        return { ok: true, voiceChannel };
    } catch (err) {
        sesiones.delete(guildId);
        limpiarSesion(sesion);
        log.warn(`No se pudo empezar la conversación en directo: ${err.stack || err.message}`);
        return { ok: false, error: "No se pudo conectar. Inténtalo otra vez en un momento." };
    }
}

module.exports = {
    hayConversacionActiva,
    empezarConversacion,
    pararConversacion,
    construirDeclaracionesHerramientas,
    construirInstruccionesSistema,
    responderLlamadasHerramientas,
    LIVE_MODEL,
    LIVE_VOICE,
    IDLE_DISCONNECT_MS,
    MAX_DURATION_MS,
};
