// 🏅 Botón 🏅 Liga del panel de ⚽ Apuestas: la clasificación de la liga de pronósticos de la temporada actual.
const { pantallaLiga } = require("../../paneles/liga");

module.exports = {
    componentHandlers: [{ types: ["button"], ids: ["liga_ver"], method: "handleButton", acl: "juegos" }],

    async handleButton(client, interaction) {
        return interaction.update(pantallaLiga(interaction.guildId, interaction.user.id));
    },
};
