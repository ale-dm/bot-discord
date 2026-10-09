// 🛡️ /pase: el pase de batalla de la temporada (#36). Solo lo ves tú (efímero). Ver systems/pase/pase.js.
const { SlashCommandBuilder } = require("discord.js");
const pase = require("../../systems/pase/pase");
const { pantallaPase } = require("../../paneles/pase");
const { efimero } = require("../../core/respuestas");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["pase_"], method: "handleButton", acl: "pase" }],
    data: new SlashCommandBuilder()
        .setName("pase")
        .setDescription("🛡️ Tu pase de batalla de la temporada: niveles, misiones y recompensas"),

    async run(client, interaction) {
        return interaction.reply(efimero(pantallaPase(interaction.guildId, interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        if (id === "pase_reclamar") {
            const r = pase.reclamar(guildId, userId);
            const aviso = r.ok
                ? `🎁 Cobrado **${r.monedas.toLocaleString("es")}** 🪙 (niveles ${r.niveles.join(", ")}).`
                : "Nada que reclamar todavía.";
            return interaction.update(pantallaPase(guildId, userId, "resumen", { aviso }));
        }
        const vista = /^pase_vista_(resumen|niveles|misiones|top)$/.exec(id)?.[1];
        if (vista) return interaction.update(pantallaPase(guildId, userId, vista));
    },
};
