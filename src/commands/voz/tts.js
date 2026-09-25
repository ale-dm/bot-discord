const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const {
    createAudioResource,
    createAudioPlayer,
    joinVoiceChannel,
    getVoiceConnection,
    entersState,
    VoiceConnectionStatus,
    AudioPlayerStatus,
    StreamType,
} = require("@discordjs/voice");
const { getGeminiTtsAudioStream, GEMINI_TTS_VOICE } = require("../../services/geminiTts");
const { logInfo, logError } = require("../../core/logger");

// Cola por guild: guildId -> Array<{text, voice, username}>
const queues = new Map();
// Player activo por guild
const players = new Map();

async function getEdgeStream(text, voice) {
    return getGeminiTtsAudioStream(text, { voice });
}

async function processQueue(guildId, connection) {
    const queue = queues.get(guildId);
    if (!queue || queue.length === 0) {
        players.delete(guildId);
        setTimeout(() => {
            try {
                connection.destroy();
            } catch {}
        }, 2000);
        return;
    }

    const { text, voice, username } = queue.shift();
    logInfo(`[TTS] Reproduciendo para ${username}: "${text.slice(0, 40)}..." con ${voice}`);

    const player = createAudioPlayer();
    players.set(guildId, player);
    connection.subscribe(player);

    try {
        const stream = await getEdgeStream(text, voice);
        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true,
        });
        resource.volume.setVolume(1.0);
        player.play(resource);
    } catch (err) {
        logError("[TTS] Error generando audio Edge TTS:", err);
        processQueue(guildId, connection);
        return;
    }

    player.on(AudioPlayerStatus.Idle, () => {
        processQueue(guildId, connection);
    });
    player.on("error", (err) => {
        logError("[TTS] Error en reproductor:", err);
        processQueue(guildId, connection);
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("tts")
        .setDescription("El bot lee en voz alta el texto en tu canal de voz.")
        .addStringOption((option) => option.setName("texto").setDescription("Texto que quieres que lea el bot").setRequired(true))
        .addStringOption((option) =>
            option
                .setName("voz")
                .setDescription("Voz a utilizar (por defecto: Puck). El idioma se detecta solo a partir del texto.")
                .setRequired(false)
                .addChoices(
                    { name: "Puck — Animada", value: "Puck" },
                    { name: "Kore — Firme", value: "Kore" },
                    { name: "Charon — Firme y grave", value: "Charon" },
                    { name: "Fenrir — Excitable", value: "Fenrir" },
                    { name: "Algenib — Áspera", value: "Algenib" },
                    { name: "Sulafat — Cálida", value: "Sulafat" },
                    { name: "Despina — Suave", value: "Despina" },
                ),
        ),

    async run(client, interaction) {
        const text = interaction.options.getString("texto");
        const voice = interaction.options.getString("voz") || GEMINI_TTS_VOICE;
        const member = interaction.member;
        const channel = member?.voice?.channel;

        if (!channel) {
            await interaction.reply({ content: "❌ Debes estar en un canal de voz para usar TTS.", flags: MessageFlags.Ephemeral });
            return;
        }

        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions.has("Connect") || !permissions.has("Speak")) {
            await interaction.reply({ content: "❌ No tengo permisos para entrar o hablar en ese canal.", flags: MessageFlags.Ephemeral });
            return;
        }

        const guildId = interaction.guild.id;

        // Añadir a la cola
        if (!queues.has(guildId)) queues.set(guildId, []);
        queues.get(guildId).push({ text, voice, username: interaction.user.username });

        const position = queues.get(guildId).length;
        const voiceLabel = voice;

        // Si ya hay un player activo, confirmar que se ha encolado
        if (players.has(guildId)) {
            await interaction.reply({
                content: `🔁 Añadido a la cola (posición ${position}) — voz: **${voiceLabel}**`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.reply({
            content: `🔊 Reproduciendo con voz **${voiceLabel}**...`,
            flags: MessageFlags.Ephemeral,
        });

        // Conectar o reutilizar conexión
        let connection = getVoiceConnection(guildId);
        // Si la conexión existente no está lista, es probable que quedara colgada
        // tras un timeout anterior; la destruimos para forzar una reconexión limpia.
        if (connection && connection.state.status !== VoiceConnectionStatus.Ready) {
            try {
                connection.destroy();
            } catch {}
            connection = null;
        }
        if (!connection) {
            try {
                connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                });
                // 20s: el handshake UDP de voz puede tardar más de lo normal en algunas redes/hosts.
                await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            } catch (err) {
                logError("[TTS] Error conectando al canal:", err);
                try {
                    connection?.destroy();
                } catch {}
                await interaction.editReply({ content: "❌ No pude conectarme al canal de voz." });
                queues.delete(guildId);
                return;
            }
        }

        processQueue(guildId, connection);
    },
};
