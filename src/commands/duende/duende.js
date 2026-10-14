// /duende: hablar con el Duende y gestionar sus personalidades y lo que recuerda de la gente.
// Las piezas están en systems/duende (config, memoria, personas) y services/duende (gemini,
// herramientas, voz); aquí queda el comando y la construcción del prompt.

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const recuerdosAuto = require("../../systems/duende/recuerdosAuto");
const { hablar } = require("../../services/duende/chat/hablar");
const acciones = require("../../paneles/duendeAcciones");
const { formularioEdicion } = require("../../discord/mensajes/recuerdos");

module.exports = {
    async handleRecuerdoAuto(client, interaction) {
        const [, decision, id] = /^recuerdo_auto_(ok|no|edit)_(\d+)$/.exec(interaction.customId) || [];
        if (!decision) return;
        // ✏️ Editar (#386): solo un admin; abre un formulario con el texto para corregirlo antes de guardarlo.
        if (decision === "edit") {
            const p = recuerdosAuto.puedeDecidir(id, interaction.user.id);
            if (!p.ok) return interaction.reply({ content: `⚠️ ${p.mensaje}`, flags: MessageFlags.Ephemeral });
            return interaction.showModal(formularioEdicion(id, p.texto));
        }
        const r = recuerdosAuto.resolver(id, interaction.user.id, decision === "ok");
        if (!r.ok) return interaction.reply({ content: `⚠️ ${r.mensaje}`, flags: MessageFlags.Ephemeral });
        return interaction.update({ content: r.mensaje, embeds: [], components: [] });
    },

    // El formulario de ✏️ Editar: guarda el texto corregido (un texto de menos de 3 caracteres se rechaza y la propuesta sigue pendiente).
    async handleRecuerdoAutoModal(client, interaction) {
        const id = interaction.customId.replace("recuerdo_auto_modal_", "");
        const r = recuerdosAuto.resolver(id, interaction.user.id, true, interaction.fields.getTextInputValue("texto"));
        if (!r.ok) return interaction.reply({ content: `⚠️ ${r.mensaje}`, flags: MessageFlags.Ephemeral });
        return interaction.update({ content: r.mensaje, embeds: [], components: [] });
    },

    componentHandlers: [
        // 🧠 Recuerdos automáticos (#15): ✅ Guardar / ✏️ Editar / ❌ Descartar de la propuesta (llega por DM a los admins).
        { types: ["button"], prefixes: ["recuerdo_auto_"], method: "handleRecuerdoAuto", acl: "duende" },
        { types: ["modal"], prefixes: ["recuerdo_auto_modal_"], method: "handleRecuerdoAutoModal", acl: "duende" },
        { types: ["button"], prefixes: ["duendepanel_"], method: "handleButton", acl: "duende" },
        { types: ["stringSelect"], prefixes: ["duendepanel_"], method: "handleSelect", acl: "duende" },
        { types: ["userSelect"], prefixes: ["duendepanel_"], method: "handleUserSelect", acl: "duende" },
        { types: ["modal"], prefixes: ["duendepanel_"], method: "handleModal", acl: "duende" },
    ],
    data: new SlashCommandBuilder().setName("duende").setDescription("🤖 El Duende: habla con él, sus recuerdos y sus personalidades"),
    hablar,

    // /duende: abre el panel (solo lo ve quien lo abre).
    async run(client, interaction) {
        await interaction.reply({ ...acciones.vistaInicio(interaction), flags: MessageFlags.Ephemeral });
    },

    handleButton: acciones.handleButton,
    handleSelect: acciones.handleSelect,
    handleUserSelect: acciones.handleUserSelect,
    handleModal: acciones.handleModal,
};
