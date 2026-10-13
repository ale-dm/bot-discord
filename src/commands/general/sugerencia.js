// 💡 /sugerencia: abre un formulario y envía la idea al canal de sugerencias (sugerencias.canal_id, en /paneladmin → ⚙️ Config
// Global → 📣 Comunidad) con su número y botones 👍 y 👎. Hasta tres al día por persona. Un admin la marca como aceptada o
// descartada desde ese mismo panel y quien la envió lo recibe por DM. Reglas en systems/sugerencias.js.
const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const sugerencias = require("../../systems/sugerencias");
const guildSettings = require("../../systems/guildSettings");
const { mensajeSugerencia } = require("../../paneles/sugerencia");
const { efimero } = require("../../core/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Sugerencias");

const SIN_CANAL = "💡 El buzón de sugerencias todavía no está configurado en este servidor: pídele a un admin que elija el canal.";

function formulario() {
    return new ModalBuilder()
        .setCustomId("sugerencia_modal")
        .setTitle("💡 Tu sugerencia")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("texto")
                    .setLabel("¿Qué propones?")
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder("Una idea para el bot o para el servidor")
                    .setMinLength(sugerencias.MIN_TEXTO)
                    .setMaxLength(sugerencias.MAX_TEXTO)
                    .setRequired(true),
            ),
        );
}

module.exports = {
    componentHandlers: [
        { types: ["modal"], prefixes: ["sugerencia_modal"], method: "handleModal", acl: "sugerencia" },
        { types: ["button"], prefixes: ["sugerencia_voto_"], method: "handleButton", acl: "sugerencia" },
    ],
    data: new SlashCommandBuilder().setName("sugerencia").setDescription("💡 Envía una idea para el bot o para el servidor"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        // Sin canal, se avisa antes de que escriba nada.
        if (!guildSettings.getSettings(interaction.guildId).sugerencias.canal_id) return interaction.reply(efimero(SIN_CANAL));
        return interaction.showModal(formulario());
    },

    async handleModal(client, interaction) {
        const canalId = guildSettings.getSettings(interaction.guildId).sugerencias.canal_id;
        if (!canalId) return interaction.reply(efimero(SIN_CANAL));
        let canal;
        try {
            canal = await client.channels.fetch(canalId);
        } catch (e) {
            log.warn(`No se pudo abrir el canal de sugerencias ${canalId}: ${e.message}`);
            return interaction.reply(efimero("❌ No puedo escribir en el canal de sugerencias. Avisa a un admin."));
        }
        const r = sugerencias.crear({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            texto: interaction.fields.getTextInputValue("texto"),
        });
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        try {
            const mensaje = await canal.send(mensajeSugerencia(r.sugerencia));
            sugerencias.guardarMensaje(r.sugerencia.id, canal.id, mensaje.id);
        } catch (e) {
            // Si no se pudo publicar, no cuenta: se borra para no gastar el cupo diario.
            sugerencias.eliminar(r.sugerencia.id);
            log.warn(`No se pudo publicar la sugerencia ${r.sugerencia.id} en ${canalId}: ${e.message}`);
            return interaction.reply(efimero("❌ No he podido publicar tu sugerencia en el canal. Avisa a un admin."));
        }
        return interaction.reply(efimero(`✅ Sugerencia #${r.sugerencia.id} enviada. Gracias.`));
    },

    // sugerencia_voto_{id}_{up|down}: vota (o cambia el voto) y repinta el marcador del propio mensaje.
    async handleButton(client, interaction) {
        const [id, lado] = interaction.customId.slice("sugerencia_voto_".length).split("_");
        const r = sugerencias.votar(id, interaction.user.id, lado === "up" ? 1 : -1);
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        return interaction.update(mensajeSugerencia(r.sugerencia));
    },
};
