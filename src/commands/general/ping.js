const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { logInfo } = require("../../core/logger");

module.exports = {
    data: new SlashCommandBuilder().setName("ping").setDescription("Comprueba la latencia del bot y de la API de Discord."),

    /**
     *
     * @param {import("discord.js").Client<true>} client
     * @param {import("discord.js").ChatInputCommandInteraction<"cached">} interaction
     */

    async run(client, interaction) {
        const sent = await interaction.reply({ content: "Calculando ping...", fetchReply: true });
        const apiLatency = client.ws.ping;
        const botLatency = sent.createdTimestamp - interaction.createdTimestamp;

        const embed = new EmbedBuilder()
            .setColor(0x00ff99)
            .setTitle("🏓 ¡Pong!")
            .addFields(
                { name: "Latencia del bot", value: `\`${botLatency} ms\``, inline: true },
                { name: "Latencia de la API", value: `\`${apiLatency} ms\``, inline: true },
            )
            .setTimestamp();

        logInfo(`[Ping] Bot: ${botLatency} ms | API: ${apiLatency} ms`);

        await interaction.editReply({ content: null, embeds: [embed] });
    },
};
