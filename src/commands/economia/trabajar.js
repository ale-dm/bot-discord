// /trabajar: ingreso con cooldown corto. Lógica en systems/duende/trabajo.js.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { trabajar } = require("../../systems/duende/trabajo");
const { createLogger } = require("../../core/logger");

const log = createLogger("Trabajar");

module.exports = {
    data: new SlashCommandBuilder().setName("trabajar").setDescription("Trabaja un rato para ganar algo de dinero (cooldown corto)."),
    async run(client, interaction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: "Esto solo funciona en un servidor.", flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply();
        const r = await trabajar(interaction.guildId, interaction.user, interaction.channelId);
        if (!r.ok) {
            const minutos = Math.ceil(r.retrySeconds / 60);
            await interaction.editReply(`⏳ Todavía no puedes volver a trabajar. Espera ${minutos} min más.`);
            return;
        }

        const linea = r.exito ? `${r.texto}\n\n💰 Has ganado **${r.cantidad.toLocaleString("es")}** 🪙.` : r.texto;
        await interaction.editReply(linea);
        log.info(`${interaction.user.tag} usó /trabajar: ${r.exito ? `+${r.cantidad}` : "sin suerte"}`);
    },
};
