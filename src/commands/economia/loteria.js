// 🎟️ /loteria (#524): el panel de la lotería semanal, para comprar boletos (al azar o eligiendo 4 números del 1 al 20) y ver
// el bote, cuándo es el sorteo, tus boletos y el último resultado. Reglas en systems/loteria.js, panel en paneles/loteria.js.
const { SlashCommandBuilder } = require("discord.js");
const loteria = require("../../systems/loteria");
const { pantallaLoteria, formularioNumeros } = require("../../paneles/loteria");
const { efimero } = require("../../discord/respuestas");

function comprar(interaction, numeros = null) {
    const r = loteria.comprar({ guildId: interaction.guildId, userId: interaction.user.id, numeros });
    const aviso = r.ok ? `🎫 ¡Boleto comprado! **${r.boleto.numeros.split("-").join(" · ")}**` : `❌ ${r.motivo}`;
    return interaction.update(pantallaLoteria(interaction.guildId, interaction.user.id, aviso));
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["loteria_"], method: "handleButton", acl: "loteria" },
        { types: ["modal"], ids: ["loteria_modal_numeros"], method: "handleModal", acl: "loteria" },
    ],
    data: new SlashCommandBuilder().setName("loteria").setDescription("🎟️ Lotería semanal: compra boletos y mira el bote"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        return interaction.reply(efimero(pantallaLoteria(interaction.guildId, interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (id === "loteria_azar") return comprar(interaction);
        if (id === "loteria_elegir") return interaction.showModal(formularioNumeros());
        return interaction.update(pantallaLoteria(interaction.guildId, interaction.user.id));
    },

    async handleModal(client, interaction) {
        const texto = interaction.fields.getTextInputValue("numeros");
        if (!loteria.leerNumeros(texto)) {
            const aviso = `❌ Escribe ${loteria.NUMEROS} números distintos del 1 al ${loteria.MAX_NUMERO}, por ejemplo «3 7 12 20».`;
            return interaction.update(pantallaLoteria(interaction.guildId, interaction.user.id, aviso));
        }
        return comprar(interaction, texto);
    },
};
