// 📝 /resumen: resume en unas cinco líneas lo hablado en el canal en los últimos N mensajes (1 a 200), con el tono de la personalidad
// del canal. Solo lo ve quien lo pide, y cuenta para el límite diario de respuestas del Duende. Si tarda más de 15 segundos, avisa.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { leerMensajes, resumir, MAX_MENSAJES } = require("../../services/duende/resumenCanal");
const { checkAndIncrementDailyLimit } = require("../../services/duende/chat/generar");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Resumen");

const AVISO_MS = 15_000;
const MIN_MENSAJES = 3;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("resumen")
        .setDescription("📝 El Duende te resume lo que se ha hablado en este canal")
        .addIntegerOption((o) =>
            o
                .setName("mensajes")
                .setDescription(`Cuántos mensajes mirar (1 a ${MAX_MENSAJES}, por defecto 50)`)
                .setMinValue(1)
                .setMaxValue(MAX_MENSAJES),
        ),

    async run(client, interaction) {
        if (!interaction.guildId || !interaction.channel?.messages) {
            return interaction.reply(efimero("Esto solo funciona en un canal de un servidor."));
        }
        // Quien no puede ver el canal no recibe el resumen.
        const permisos = interaction.channel.permissionsFor?.(interaction.member);
        if (permisos && !permisos.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
            return interaction.reply(efimero("⛔ No puedes ver el historial de este canal."));
        }
        const limite = checkAndIncrementDailyLimit(interaction.user.id);
        if (!limite.ok) {
            return interaction.reply(
                efimero(
                    limite.motivo === "usuario"
                        ? "Ya has gastado tus respuestas de hoy con el Duende. ¡Mañana más!"
                        : "El Duende ha llegado a su límite de hoy. ¡Hasta mañana!",
                ),
            );
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const aviso = setTimeout(() => interaction.editReply("⏳ Sigo trabajando en el resumen…").catch(() => {}), AVISO_MS);
        try {
            const mensajes = await leerMensajes(interaction.channel, interaction.options.getInteger("mensajes") ?? 50);
            if (mensajes.length < MIN_MENSAJES) return interaction.editReply("No hay bastante conversación reciente para resumir. 🤷");
            const texto = await resumir(interaction.channelId, mensajes);
            return interaction.editReply({
                content: `📝 **Resumen de los últimos ${mensajes.length} mensajes**\n${texto || "No he sabido resumirlo."}`,
                allowedMentions: { parse: [] },
            });
        } catch (e) {
            log.warn(`No se pudo resumir el canal ${interaction.channelId}: ${e.message}`);
            return interaction.editReply("❌ No he podido hacer el resumen ahora. Prueba otra vez en un rato.");
        } finally {
            clearTimeout(aviso);
        }
    },
};
