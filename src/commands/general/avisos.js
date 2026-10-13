// 🔔 /avisos: elige qué DM te manda el bot (racha, partidos, Wrapped...) o apágalos todos con "no molestar". Es un panel
// privado con un botón por tipo (prefijo avisos_). Las preferencias y el envío están en systems/avisosDm.js.
const { SlashCommandBuilder } = require("discord.js");
const avisosDm = require("../../systems/avisosDm");
const { buildAvisos } = require("../../paneles/avisos");
const { efimero } = require("../../core/respuestas");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["avisos_"], method: "handleButton" }],
    data: new SlashCommandBuilder().setName("avisos").setDescription("🔔 Elige qué avisos te manda el bot por DM"),

    async run(client, interaction) {
        return interaction.reply(efimero(buildAvisos(interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const id = interaction.customId;
        if (id === "avisos_nm") {
            avisosDm.fijarNoMolestar(userId, !avisosDm.noMolestar(userId));
        } else if (id.startsWith("avisos_t_")) {
            const tipo = id.slice("avisos_t_".length);
            if (!avisosDm.tipoValido(tipo)) return interaction.reply(efimero("❌ Ese aviso ya no existe."));
            const actual = avisosDm.estado(userId).tipos.find((t) => t.id === tipo).activo;
            avisosDm.fijar(userId, tipo, !actual);
        }
        return interaction.update(buildAvisos(userId));
    },
};
