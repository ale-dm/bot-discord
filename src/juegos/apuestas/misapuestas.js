// Botones de la pestaña 📋 Mis jugadas de /juegos (antes el comando /misapuestas): cambian de vista en el
// mismo mensaje. Stats (de mensajes antiguos) abre la pestaña 📊 Stats, que ya junta casino y apuestas.
const { MessageFlags } = require("discord.js");
const { buildMisJugadas } = require("../../paneles/misJugadas");
const { buildStatsJuegos } = require("../../paneles/juegos");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["misapuestas_"], method: "handleButton", acl: "juegos" }],

    // misapuestas_{vista}_{userId}: solo quien las abrió puede cambiar de vista.
    async handleButton(client, interaction) {
        const [, vista, userId] = interaction.customId.split("_");
        if (interaction.user.id !== userId) {
            await interaction.reply({ content: "❌ Solo puedes ver tus propias apuestas.", flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.update(vista === "stats" ? buildStatsJuegos(userId, interaction.user.username) : buildMisJugadas(userId, vista));
    },
};
