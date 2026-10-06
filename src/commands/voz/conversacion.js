// Conversación de voz en directo con el Duende (Gemini Live API): audio bidireccional real,
// no por turnos. Funcionalidad nueva y aparte de /escuchar (que sigue igual, sin tocar).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createLogger } = require("../../core/logger");
const liveVoz = require("../../services/duende/liveVoz");

const log = createLogger("VozEnVivo");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("conversación")
        .setDescription("Empieza (o termina) una conversación de voz en directo con el Duende."),
    async run(client, interaction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: "Esto solo funciona en un servidor.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (liveVoz.hayConversacionActiva(interaction.guildId)) {
            liveVoz.pararConversacion(interaction.guildId, "pedido con /conversación");
            await interaction.reply("🔴 Conversación en directo terminada.");
            return;
        }

        await interaction.deferReply();
        const r = await liveVoz.empezarConversacion(interaction, {
            onTerminada: (motivo) => {
                interaction.channel
                    ?.send(`🔴 Conversación en directo terminada${motivo ? ` (${motivo})` : ""}.`)
                    .catch((e) => log.debug(`No se pudo avisar de que terminó la conversación: ${e.message}`));
            },
        });
        if (!r.ok) {
            await interaction.editReply(r.error);
            return;
        }
        log.info(`Conversación en directo empezada en ${r.voiceChannel.name} (pedida por ${interaction.user.tag})`);
        await interaction.editReply(
            `🟢 Conversación en directo empezada en **${r.voiceChannel.name}**. Habla cuando quieras; usa \`/conversación\` otra vez para terminarla.`,
        );
    },
};
