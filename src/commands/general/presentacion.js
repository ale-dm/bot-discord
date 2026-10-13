// 💬 /presentacion: una frase sobre ti (hasta 150 caracteres) que sale en 👤 Perfil de /perfil cuando otra persona lo abre.
// Se escribe en un formulario con lo que ya tenías; enviarlo vacío la borra. También se abre con ✏️ Editar en tu propio
// perfil (presentacion_editar_{userId}). Los datos están en systems/presentaciones.js.
const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const presentaciones = require("../../systems/presentaciones");
const { efimero } = require("../../core/respuestas");

function formulario(userId) {
    const actual = presentaciones.obtener(userId);
    const texto = new TextInputBuilder()
        .setCustomId("texto")
        .setLabel("Tu presentación (vacío = borrarla)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Betis, cine de terror y mala suerte en la ruleta")
        .setMaxLength(presentaciones.MAX_PRESENTACION)
        .setRequired(false);
    if (actual) texto.setValue(actual);
    return new ModalBuilder()
        .setCustomId("presentacion_modal")
        .setTitle("💬 Tu presentación")
        .addComponents(new ActionRowBuilder().addComponents(texto));
}

module.exports = {
    componentHandlers: [
        { types: ["modal"], prefixes: ["presentacion_modal"], method: "handleModal" },
        { types: ["button"], prefixes: ["presentacion_editar_"], method: "handleButton" },
    ],
    data: new SlashCommandBuilder().setName("presentacion").setDescription("💬 Escribe una frase sobre ti que sale en tu perfil"),

    async run(client, interaction) {
        return interaction.showModal(formulario(interaction.user.id));
    },

    // presentacion_editar_{userId}: el ✏️ Editar del perfil propio. Solo abre el formulario a su dueño.
    async handleButton(client, interaction) {
        const dueno = interaction.customId.slice("presentacion_editar_".length);
        if (dueno !== interaction.user.id) return interaction.reply(efimero("⛔ Solo puedes editar tu propia presentación."));
        return interaction.showModal(formulario(interaction.user.id));
    },

    async handleModal(client, interaction) {
        const r = presentaciones.guardar(interaction.user.id, interaction.fields.getTextInputValue("texto"));
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        return interaction.reply(
            efimero(r.texto ? `✅ Presentación guardada: «${presentaciones.escapar(r.texto)}»` : "🗑️ Presentación borrada."),
        );
    },
};
