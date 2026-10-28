// 📨 /invitaciones (#522): a quién has invitado al servidor, cuántos están pendientes de madurar, lo que has cobrado y el
// próximo hito, más los 10 que más invitan. Reglas en systems/invitaciones.js, pantalla en paneles/invitaciones.js.
const { SlashCommandBuilder } = require("discord.js");
const { pantallaInvitaciones } = require("../../paneles/invitaciones");
const { efimero } = require("../../discord/respuestas");

module.exports = {
    data: new SlashCommandBuilder().setName("invitaciones").setDescription("📨 A quién has invitado y lo que has ganado por ello"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        return interaction.reply(efimero(pantallaInvitaciones(interaction.guildId, interaction.user.id)));
    },
};
