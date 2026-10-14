// 🛡️ /pase: el pase de batalla de la temporada (#36). Solo lo ves tú (efímero). Ver systems/pase/pase.js.
const { SlashCommandBuilder } = require("discord.js");
const pase = require("../../systems/pase/pase");
const { pantallaPase } = require("../../paneles/pase");
const { efimero } = require("../../discord/respuestas");

/** El texto de lo que reclama alguien: las monedas, los niveles y los objetos (#364). */
function avisoDeReclamar(r) {
    if (!r.ok) return "Nada que reclamar todavía.";
    const objetos = r.objetos ? ` y 🎒 ${r.objetos.map((o) => o.nombre).join(", ")}` : "";
    return `🎁 Cobrado **${r.monedas.toLocaleString("es")}** 🪙${objetos} (niveles ${r.niveles.join(", ")}).`;
}

module.exports = {
    componentHandlers: [{ types: ["button", "stringSelect"], prefixes: ["pase_"], method: "handleButton", acl: "pase" }],
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
            return interaction.update(pantallaPase(guildId, userId, "resumen", { aviso: avisoDeReclamar(r) }));
        }
        // 🕰️ La temporada pasada que se elige en el menú del historial.
        if (id === "pase_historial_sel") {
            return interaction.update(pantallaPase(guildId, userId, "historial", { temporada: interaction.values[0] }));
        }
        const vista = /^pase_vista_(resumen|niveles|misiones|top|topes|historial)$/.exec(id)?.[1];
        if (vista) return interaction.update(pantallaPase(guildId, userId, vista));
    },
};
