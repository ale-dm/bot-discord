const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder().setName("javier").setDescription("Eres un mierdas."),

    /**
     *
     * @param {import("discord.js").Client<true>} client
     * @param {import("discord.js").ChatInputCommandInteraction<"cached">} interaction
     */

    async run(client, interaction) {
        interaction.reply(`Eres un mierdas.`);
    },
};
