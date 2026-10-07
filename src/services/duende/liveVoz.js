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

const LIVE_MODEL = process.env.DUENDE_LIVE_MODEL || "gemini-live-2.5-flash-preview";
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
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        }
        sesion.connection = connection;

        // Salida: un ffmpeg para toda la llamada, del PCM 24kHz mono que manda Gemini al
        // 48kHz estéreo que espera @discordjs/voice en crudo (StreamType.Raw).
        const ffmpeg = new prism.FFmpeg({
            args: ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
        });
        sesion.ffmpeg = ffmpeg;
        const player = createAudioPlayer();
        const resource = createAudioResource(ffmpeg, { inputType: StreamType.Raw, inlineVolume: true });
        connection.subscribe(player);
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
            },
            callbacks: {
                onopen: () => log.info(`Conversación en directo abierta en ${voiceChannel.name} (${interaction.guild.name})`),
                onmessage: (message) => {
                    marcarActividad();
                    if (message.toolCall) {
                        responderLlamadasHerramientas(liveSession, message.toolCall, toolContext).catch((e) =>
                            log.warn(`Error respondiendo herramientas en voz en directo: ${e.message}`),
                        );
                    }
                    if (message.data) {
                        try {
                            ffmpeg.stdin.write(Buffer.from(message.data, "base64"));
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
                onerror: (e) => log.warn(`Error en la conversación en directo: ${e?.message || e}`),
                onclose: () => log.debug(`Conversación en directo cerrada (socket) en el servidor ${guildId}`),
            },
        });
        sesion.liveSession = liveSession;

        // Entrada: todo lo que diga quien ha pedido /conversación mientras dure la llamada (no
        // una sola intervención como /escuchar: EndBehaviorType.Manual no corta sola).
        const receiver = connection.receiver;
        const opusStream = receiver.subscribe(interaction.user.id, { end: { behavior: EndBehaviorType.Manual } });
        sesion.opusStream = opusStream;
        const pcmStream = opusStream.pipe(new prism.opus.Decoder({ channels: 1, rate: 16000, frameSize: 320 }));
        pcmStream.on("data", (chunk) => {
            marcarActividad();
            try {
                liveSession.sendRealtimeInput({ media: { data: chunk.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
            } catch (e) {
                log.warn(`Error enviando audio a Gemini Live: ${e.message}`);
            }
        });

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
        log.warn(`No se pudo empezar la conversación en directo: ${err.message}`);
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
