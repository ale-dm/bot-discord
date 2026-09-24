// sttCommand.js
const { createLogger } = require("../../core/logger");

const sttCmdLog = createLogger("STT");
// Comando de prueba para activar STT en un canal de voz
const { SlashCommandBuilder } = require("discord.js");
const { listenAndTranscribe } = require("../../services/stt");
const duende = require("../duende/duende");

// Tras cada respuesta hablada, el Duende se re-arma solo para tu siguiente frase durante
// esta ventana, sin que haga falta volver a escribir /escuchar en mitad de la charla.
const DUENDE_VOICE_ACTIVE_WINDOW_MS = Number(process.env.DUENDE_VOICE_ACTIVE_WINDOW_MS || 60 * 1000);

function startListeningLoop(client, guildId, channelId, targetUserId, textChannel, isFirstTurn) {
    listenAndTranscribe(
        client,
        guildId,
        channelId,
        targetUserId,
        async (transcript, ctx) => {
            if (transcript && String(transcript).trim()) {
                // Responde por voz usando duende.js
                await duende.run(client, {
                    guild: ctx.guild,
                    channel: textChannel,
                    user: ctx.user,
                    forceVoiceReply: true,
                    silentTextReply: true,
                    options: {
                        getSubcommand: () => "talk",
                        getString: (name) => (name === "texto" ? transcript : null),
                    },
                    deferReply: async () => {},
                    editReply: async () => {},
                    followUp: async () => {},
                });
                // Charla activa: se re-arma solo para la siguiente frase (ventana más corta).
                startListeningLoop(client, guildId, channelId, targetUserId, textChannel, false);
            } else if (isFirstTurn) {
                if (textChannel && textChannel.isTextBased()) {
                    textChannel
                        .send("No pude entender el audio. Habla 2-4s más cerca del micro y deja 1-2s de silencio al final.")
                        .catch((e) => sttCmdLog.warn(`No se pudo avisar en el canal de texto: ${e.message}`));
                }
            }
            // Si no hay transcripción en un turno de re-arme, la sesión termina en silencio
            // (hace falta /escuchar de nuevo para retomar).
        },
        { timeoutMs: isFirstTurn ? undefined : DUENDE_VOICE_ACTIVE_WINDOW_MS },
    ).catch((e) => sttCmdLog.error(`No se pudo empezar a escuchar en el canal ${channelId}:`, e));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("escuchar")
        .setDescription("El bot escucha una voz y responde por voz usando IA.")
        .addUserOption((option) => option.setName("usuario").setDescription("Usuario a escuchar (por defecto: tú)").setRequired(false)),
    async run(client, interaction) {
        // Solo funciona en servidores y si el usuario está en un canal de voz
        const member = interaction.member;
        const voiceChannel = member.voice && member.voice.channel;
        if (!voiceChannel) {
            await interaction.reply({ content: "¡Debes estar en un canal de voz!", ephemeral: true });
            return;
        }
        const selectedUser = interaction.options.getUser("usuario");
        const targetUser = selectedUser || interaction.user;
        let targetMember = null;
        try {
            targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch (e) {
            sttCmdLog.warn(`No se pudo obtener el miembro ${targetUser.id}: ${e.message}`);
        }

        if (!targetMember || !targetMember.voice || targetMember.voice.channelId !== voiceChannel.id) {
            await interaction.reply({
                content: "Ese usuario debe estar en tu mismo canal de voz para poder escucharlo.",
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            content: `Escuchando a **${targetUser.username}** en su próxima intervención de voz...`,
            ephemeral: true,
        });
        sttCmdLog.info(`Escuchando a ${targetUser.tag} en ${voiceChannel.name} (pedido por ${interaction.user.tag})`);
        startListeningLoop(client, interaction.guild.id, voiceChannel.id, targetUser.id, interaction.channel, true);
    },
};
