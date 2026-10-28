// 🏆 /torneo (#525): el torneo de casino en marcha del servidor (en privado, con su botón de inscribirse) y el botón del
// mensaje público. Los crea y cancela un admin en /paneladmin → ⚙️ Config Global → 🛡️ Economía → 🎟️ Más economía.
// Reglas en systems/torneos.js, mensaje en paneles/torneo.js.
const { SlashCommandBuilder } = require("discord.js");
const torneos = require("../../systems/torneos");
const envios = require("../../discord/envios/torneos");
const { mensajeTorneo } = require("../../paneles/torneo");
const { efimero } = require("../../discord/respuestas");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["torneo_"], method: "handleButton", acl: "torneo" }],
    data: new SlashCommandBuilder().setName("torneo").setDescription("🏆 El torneo de casino del servidor: inscripción y clasificación"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const t = torneos.activo(interaction.guildId);
        if (!t) return interaction.reply(efimero("🏆 Ahora mismo no hay ningún torneo de casino. Los organizan los admins."));
        return interaction.reply(efimero(mensajeTorneo(t)));
    },

    // torneo_inscribir_{id}
    async handleButton(client, interaction) {
        const id = Number(interaction.customId.slice("torneo_inscribir_".length));
        const r = torneos.inscribir(id, interaction.user.id);
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        await interaction.reply(efimero(`🎟️ ¡Inscrito en el torneo #${id}! Juega a lo que toca cuando empiece.`));
        await envios.repintar(client, r.torneo);
    },
};
