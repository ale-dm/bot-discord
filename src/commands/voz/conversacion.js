// Conversación de voz en directo con el Duende (Gemini Live API): audio bidireccional real,
// no por turnos. Funcionalidad nueva y aparte de /escuchar (que sigue igual, sin tocar).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createLogger } = require("../../core/logger");
const liveVoz = require("../../services/duende/liveVoz");

const log = createLogger("VozEnVivo");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("conversación")
        .setDescription("Empieza (o termina) una conversación de voz en directo con el Duende.")
        .addStringOption((option) =>
            option
                .setName("modo")
                .setDescription("Por defecto solo contesta si dices 'Duende' al hablar. Solo se usa al empezar la llamada.")
                .setRequired(false)
                .addChoices(
                    { name: "Solo si le llamas por su nombre (por defecto)", value: "mencion" },
                    { name: "Siempre responde", value: "siempre" },
                ),
        ),
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
        const soloSiLeLlaman = interaction.options.getString("modo") !== "siempre";
        const r = await liveVoz.empezarConversacion(interaction, {
            soloSiLeLlaman,
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
        const comoContesta = soloSiLeLlaman ? "Solo te contestará si dices «Duende» al hablar." : "Te contestará a todo lo que digas.";
        await interaction.editReply(
            `🟢 Conversación en directo empezada en **${r.voiceChannel.name}**. ${comoContesta} Dile que cuelgue o usa \`/conversación\` otra vez para terminarla.`,
        );
    },
};
