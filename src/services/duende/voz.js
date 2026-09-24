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

async function getEdgeAudioStream(text, voice = DUENDE_TTS_VOICE) {
    return getGeminiTtsAudioStream(String(text || ""), { voice });
}

async function tryVoiceReply(client, interaction, respuesta) {
    let connection = null;
    try {
        // Paso a paso de la conexión de voz: solo con LOG_LEVEL=debug.
        const log = (...args) => voiceLog.debug(...args);

        // Buscar guild y miembro de forma segura
        let guild = interaction.guild;
        log("Obteniendo guild... interaction.guild:", !!interaction.guild, "guildId:", interaction.guildId);
        if (!guild) {
            if (interaction.guildId && client.guilds && typeof client.guilds.fetch === "function") {
                try {
                    guild = await client.guilds.fetch(interaction.guildId);
                    log("Guild obtenido por guildId:", guild.id);
                } catch (e) {
                    voiceLog.warn("No se pudo obtener el guild por guildId:", interaction.guildId, e);
                    return false;
                }
            } else {
                log("No hay guild en interaction y no se puede obtener por guildId. Probablemente DM o contexto inválido.");
                return false;
            }
        }
        log("Buscando miembro:", interaction.user.id);
        const member = await guild.members.fetch(interaction.user.id);
        log("Member obtenido:", !!member, "ID:", member ? member.id : null);
        const voiceChannel = member.voice?.channel;
        log("Intentando voz. Canal detectado:", !!voiceChannel, "Canal:", voiceChannel ? voiceChannel.id : null);
        if (!voiceChannel) {
            log("No hay canal de voz.");
            return false;
        }

        // Decide probabilísticamente si responder por voz
        const forceVoiceReply = !!interaction?.forceVoiceReply;
        if (!forceVoiceReply && Math.random() >= VOICE_REPLY_PROB) {
            log("Decisión probabilística: no se responde por voz esta vez.");
            return false;
        }

        // Permisos
        const permissions = voiceChannel.permissionsFor(guild.members.me);
        log("Permisos del bot en canal:", permissions ? permissions.toArray() : null);
        if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
            voiceLog.warn("Faltan permisos para conectar/hablar en el canal de voz.");
            return false;
        }

        // Generar TTS Microsoft (máx 200 caracteres)
        let audioStream;
        try {
            audioStream = await getEdgeAudioStream(respuesta.slice(0, 200), DUENDE_TTS_VOICE);
            log("Audio TTS generado con voz:", DUENDE_TTS_VOICE);
        } catch (err) {
            voiceLog.warn("Error generando el audio TTS:", err);
            return false;
        }

        // Reutilizar conexión existente si sigue viva y en el canal correcto, para no
        // meter un handshake de voz (hasta 20s) entre cada turno de la conversación.
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
        } catch (err) {
            voiceLog.warn("Error al unirse al canal de voz:", err);
            try {
                connection?.destroy();
            } catch {}
            return false;
        }

        // Crea el reproductor y recurso de audio desde stream
        const player = createAudioPlayer();
        let resource;
        try {
            resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary, inlineVolume: true });
            resource.volume.setVolume(1.0);
            log("Recurso de audio creado y volumen ajustado.");
        } catch (err) {
            voiceLog.warn("Error preparando el audio el audio TTS:", err);
            return false;
        }

        log("Suscribiendo conexión al reproductor...");
        connection.subscribe(player);
        log("Iniciando reproducción...");
        player.play(resource);
        log("Reproducción iniciada.");

        const scheduleIdleDisconnect = () => {
            const prev = voiceIdleTimers.get(guild.id);
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => {
                voiceIdleTimers.delete(guild.id);
                try {
                    connection.destroy();
                    voiceLog.info(
                        `Salgo del canal de voz de ${guild.name} tras ${Math.round(VOICE_IDLE_DISCONNECT_MS / 1000)} s sin hablar`,
                    );
                } catch (e) {
                    voiceLog.debug(`Error destruyendo la conexión inactiva: ${e.message}`);
                }
            }, VOICE_IDLE_DISCONNECT_MS);
            voiceIdleTimers.set(guild.id, timer);
        };

        await new Promise((resolve) => {
            player.on("idle", () => {
                log("TTS terminó (evento Idle). Manteniendo conexión por si continúa la conversación.");
                scheduleIdleDisconnect();
                resolve();
            });
            player.on("error", (error) => {
                voiceLog.warn("Error en el reproductor de audio:", error);
                scheduleIdleDisconnect();
                resolve();
            });
        });
        voiceLog.info(`Respuesta por voz reproducida en ${voiceChannel.name} (${guild.name}) para ${interaction.user.tag}`);
        return true;
    } catch (err) {
        try {
            connection?.destroy();
        } catch {}
        // Log error using logger only (avoid noisy console output)
        voiceLog.error("Error general respondiendo por voz:", err);
        return false;
    }
}

module.exports = { tryVoiceReply };
