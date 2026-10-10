// Respuesta por voz del Duende: entra al canal de voz de quien le habla y dice la respuesta (Gemini TTS).
const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    StreamType,
} = require("@discordjs/voice");
const { createLogger } = require("../../core/logger");
const { getGeminiTtsAudioStream, GEMINI_TTS_VOICE } = require("../geminiTts");

const voiceLog = createLogger("Duende").child("Voz");

const VOICE_REPLY_PROB = Number(process.env.DUENDE_VOICE_REPLY_PROB || 0.1);
const DUENDE_TTS_VOICE = process.env.DUENDE_TTS_VOICE || GEMINI_TTS_VOICE;

// Tiempo que se mantiene viva la conexión de voz tras la última respuesta hablada,
// para poder encadenar turnos de conversación sin reconectar (handshake UDP) cada vez.
const VOICE_IDLE_DISCONNECT_MS = Number(process.env.DUENDE_VOICE_IDLE_DISCONNECT_MS || 5 * 60 * 1000);
const voiceIdleTimers = new Map(); // guildId -> Timeout

// Tope de una respuesta sonando: si el audio se queda parado sin acabar ni fallar, se corta aquí (si no, la
// promesa de tryVoiceReply, que /escuchar espera, no se resolvería nunca).
const VOICE_PLAYBACK_MAX_MS = Number(process.env.DUENDE_VOICE_PLAYBACK_MAX_MS || 2 * 60 * 1000);
const reproductorActivo = new Map(); // guildId -> AudioPlayer sonando

async function getTtsAudioStream(text, voice = DUENDE_TTS_VOICE) {
    return getGeminiTtsAudioStream(String(text || ""), { voice });
}

const MAX_CARACTERES_VOZ = 200;

/**
 * El texto de una respuesta tal como se dice en voz alta: las menciones (<@id>) pasan a ser el nombre de la persona, y
 * se quitan emojis del servidor, enlaces y símbolos de formato (**, _, `...). Como mucho MAX_CARACTERES_VOZ, cortando
 * por una palabra entera.
 */
function textoParaVoz(texto, guild = null) {
    const nombre = (id) => {
        const m = guild?.members?.cache?.get?.(id);
        return m?.displayName || m?.user?.globalName || m?.user?.username || "";
    };
    let t = String(texto || "")
        .replace(/<@!?(\d+)>/g, (_, id) => nombre(id))
        .replace(/<a?:(\w+):\d+>/g, "")
        .replace(/<[#@&]\d+>/g, "")
        .replace(/<t:\d+(:\w)?>/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[*_`~>|#]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (t.length > MAX_CARACTERES_VOZ) {
        const corte = t.slice(0, MAX_CARACTERES_VOZ);
        const espacio = corte.lastIndexOf(" ");
        t = (espacio > MAX_CARACTERES_VOZ / 2 ? corte.slice(0, espacio) : corte).replace(/[,;:\s]+$/, "");
    }
    return t;
}

// Paso a paso de la conexión de voz: solo con LOG_LEVEL=debug.
const log = (...args) => voiceLog.debug(...args);

/** El guild donde está quien habla: el de la interacción o, si falta, el que se pide por su id. */
async function guildDeLaInteraccion(client, interaction) {
    let guild = interaction.guild;
    log("Obteniendo guild... interaction.guild:", !!interaction.guild, "guildId:", interaction.guildId);
    if (guild) return guild;
    if (interaction.guildId && client.guilds && typeof client.guilds.fetch === "function") {
        try {
            guild = await client.guilds.fetch(interaction.guildId);
            log("Guild obtenido por guildId:", guild.id);
            return guild;
        } catch (e) {
            voiceLog.warn("No se pudo obtener el guild por guildId:", interaction.guildId, e);
            return null;
        }
    }
    log("No hay guild en interaction y no se puede obtener por guildId. Probablemente DM o contexto inválido.");
    return null;
}

/** El canal de voz en el que está quien habla, o null si no está en ninguno. */
async function canalDeQuienHabla(guild, interaction) {
    log("Buscando miembro:", interaction.user.id);
    const member = await guild.members.fetch(interaction.user.id);
    log("Member obtenido:", !!member, "ID:", member ? member.id : null);
    const voiceChannel = member.voice?.channel;
    log("Intentando voz. Canal detectado:", !!voiceChannel, "Canal:", voiceChannel ? voiceChannel.id : null);
    if (!voiceChannel) log("No hay canal de voz.");
    return voiceChannel ?? null;
}

/** Decide si la respuesta sale por voz esta vez: con probabilidad, salvo que se fuerce. */
function toca(interaction) {
    const forceVoiceReply = !!interaction?.forceVoiceReply;
    if (!forceVoiceReply && Math.random() >= VOICE_REPLY_PROB) {
        log("Decisión probabilística: no se responde por voz esta vez.");
        return false;
    }
    return true;
}

/** Si el bot puede conectar y hablar en ese canal. */
function puedeHablarEn(voiceChannel, guild) {
    const permissions = voiceChannel.permissionsFor(guild.members.me);
    log("Permisos del bot en canal:", permissions ? permissions.toArray() : null);
    if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
        voiceLog.warn("Faltan permisos para conectar/hablar en el canal de voz.");
        return false;
    }
    return true;
}

/** El audio de Gemini TTS del texto limpio para leerlo en voz alta. Null si no hay nada que decir o el TTS falla. */
async function audioDeRespuesta(respuesta, guild) {
    const textoHablado = textoParaVoz(respuesta, guild);
    if (!textoHablado) {
        log("Nada que decir en voz alta tras limpiar el texto.");
        return null;
    }
    try {
        const audioStream = await getTtsAudioStream(textoHablado, DUENDE_TTS_VOICE);
        log("Audio TTS generado con voz:", DUENDE_TTS_VOICE);
        return audioStream;
    } catch (err) {
        voiceLog.warn("Error generando el audio TTS:", err);
        return null;
    }
}

/**
 * Conexión de voz en el canal, reutilizando la que siga viva para no meter un handshake de voz (hasta 20s) entre cada
 * turno de la conversación. Null si no se pudo unir.
 */
async function conectarAlCanal(guild, voiceChannel) {
    let connection = null;
    try {
        const existing = getVoiceConnection(guild.id);
        const existingIsUsable =
            existing &&
            existing.joinConfig.channelId === voiceChannel.id &&
            existing.state.status !== VoiceConnectionStatus.Destroyed &&
            existing.state.status !== VoiceConnectionStatus.Disconnected;

        if (existingIsUsable) {
            log("Reutilizando conexión de voz existente en el mismo canal, estado:", existing.state.status);
            connection = existing;
        } else {
            if (existing) {
                log(
                    "Conexión existente inservible (estado:",
                    existing.state.status,
                    "o canal distinto) - destruyendo antes de reconectar.",
                );
                try {
                    existing.destroy();
                } catch (e) {
                    voiceLog.warn("Error destruyendo conexión existente:", e);
                }
            }

            log("Intentando unirse al canal de voz:", voiceChannel.id);
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            // 20s: el handshake UDP de voz puede tardar más de lo normal en algunas redes/hosts.
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            log("Conexión de voz establecida.");
        }

        // Cancela cualquier desconexión por inactividad pendiente: seguimos usando el canal.
        const pendingDisconnect = voiceIdleTimers.get(guild.id);
        if (pendingDisconnect) {
            clearTimeout(pendingDisconnect);
            voiceIdleTimers.delete(guild.id);
        }
        return connection;
    } catch (err) {
        voiceLog.warn("Error al unirse al canal de voz:", err);
        try {
            connection?.destroy();
        } catch (e) {
            voiceLog.debug(`La conexión ya estaba destruida: ${e.message}`);
        }
        return null;
    }
}

/** Sale del canal tras VOICE_IDLE_DISCONNECT_MS sin hablar. Una respuesta nueva antes lo cancela (conectarAlCanal). */
function programarSalidaPorInactividad(connection, guild) {
    const prev = voiceIdleTimers.get(guild.id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
        voiceIdleTimers.delete(guild.id);
        try {
            connection.destroy();
            voiceLog.info(`Salgo del canal de voz de ${guild.name} tras ${Math.round(VOICE_IDLE_DISCONNECT_MS / 1000)} s sin hablar`);
        } catch (e) {
            voiceLog.debug(`Error destruyendo la conexión inactiva: ${e.message}`);
        }
    }, VOICE_IDLE_DISCONNECT_MS);
    voiceIdleTimers.set(guild.id, timer);
}

/** Reproduce el audio en la conexión y espera a que acabe o falle. False si no se pudo preparar el recurso. */
async function reproducirRespuesta(connection, audioStream, guild) {
    // Si todavía suena una respuesta de este servidor, se corta: la conexión solo puede tener un reproductor suscrito.
    reproductorActivo.get(guild.id)?.stop(true);
    const player = createAudioPlayer();
    reproductorActivo.set(guild.id, player);
    let resource;
    try {
        resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
        resource.volume.setVolume(1.0);
        log("Recurso de audio creado y volumen ajustado.");
    } catch (err) {
        voiceLog.warn("Error preparando el audio TTS:", err);
        return false;
    }

    log("Suscribiendo conexión al reproductor...");
    connection.subscribe(player);
    log("Iniciando reproducción...");
    player.play(resource);
    log("Reproducción iniciada.");

    await new Promise((resolve) => {
        let terminada = false;
        const terminar = () => {
            if (terminada) return;
            terminada = true;
            clearTimeout(tope);
            if (reproductorActivo.get(guild.id) === player) reproductorActivo.delete(guild.id);
            programarSalidaPorInactividad(connection, guild);
            resolve();
        };
        const tope = setTimeout(() => {
            voiceLog.warn(`La respuesta por voz sigue sonando tras ${Math.round(VOICE_PLAYBACK_MAX_MS / 1000)} s: se corta.`);
            player.stop(true);
            terminar();
        }, VOICE_PLAYBACK_MAX_MS);
        player.on("idle", () => {
            log("TTS terminó (evento Idle). Manteniendo conexión por si continúa la conversación.");
            terminar();
        });
        player.on("error", (error) => {
            voiceLog.warn("Error en el reproductor de audio:", error);
            terminar();
        });
    });
    return true;
}

async function tryVoiceReply(client, interaction, respuesta) {
    let connection = null;
    try {
        const guild = await guildDeLaInteraccion(client, interaction);
        if (!guild) return false;

        const voiceChannel = await canalDeQuienHabla(guild, interaction);
        if (!voiceChannel || !toca(interaction) || !puedeHablarEn(voiceChannel, guild)) return false;

        const audioStream = await audioDeRespuesta(respuesta, guild);
        if (!audioStream) return false;

        connection = await conectarAlCanal(guild, voiceChannel);
        if (!connection) return false;

        if (!(await reproducirRespuesta(connection, audioStream, guild))) return false;
        voiceLog.info(`Respuesta por voz reproducida en ${voiceChannel.name} (${guild.name}) para ${interaction.user.tag}`);
        return true;
    } catch (err) {
        try {
            connection?.destroy();
        } catch (e) {
            voiceLog.debug(`La conexión ya estaba destruida: ${e.message}`);
        }
        // Log error using logger only (avoid noisy console output)
        voiceLog.error("Error general respondiendo por voz:", err);
        return false;
    }
}

module.exports = { tryVoiceReply, textoParaVoz };
