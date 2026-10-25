// ⚠️ /avisar (#542): el staff avisa a un miembro con un motivo. Le llega por DM, suma un strike y queda en el log de moderación
// y en la auditoría. Al cruzar un umbral se avisa a los admins con la medida sugerida, pero el bot no sanciona a nadie. Pueden
// usarlo quienes tengan Moderar miembros, los admins y el rol de staff de ⚠️ Moderación (por eso no lleva permiso por defecto:
// así el rol de staff lo ve; el permiso se comprueba aquí).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const moderacion = require("../../systems/moderacion");
const adminAudit = require("../../systems/adminAudit");
const { notificar } = require("../../discord/envios/moderacion");

const responder = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

module.exports = {
    data: new SlashCommandBuilder()
        .setName("avisar")
        .setDescription("⚠️ Staff: avisa a un miembro con un motivo (le llega por DM y suma un strike)")
        .addUserOption((o) => o.setName("usuario").setDescription("A quién avisas").setRequired(true))
        .addStringOption((o) =>
            o.setName("motivo").setDescription("Por qué (le llega por DM)").setRequired(true).setMaxLength(moderacion.MOTIVO_MAX),
        ),

    async run(client, interaction) {
        const { guild, guildId, user } = interaction;
        if (!guild) return responder(interaction, "Esto solo funciona en un servidor.");
        if (!moderacion.puedeAvisar(interaction.member, guildId))
            return responder(interaction, "⛔ Solo el staff puede avisar (Moderar miembros o el rol de staff).");
        const objetivo = interaction.options.getUser("usuario");
        if (objetivo.bot) return responder(interaction, "❌ A un bot no se le avisa.");
        const motivo = interaction.options.getString("motivo");
        const resultado = moderacion.avisar({ guildId, userId: objetivo.id, staffId: user.id, motivo });
        if (!resultado.ok) return responder(interaction, `❌ ${resultado.motivo}`);

        adminAudit.logAdminAction({
            guildId,
            actorId: user.id,
            action: "moderacion.aviso",
            details: { id: resultado.id, userId: objetivo.id, vigentes: resultado.vigentes, umbral: resultado.umbral?.clave ?? null },
        });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { dm, admins } = await notificar(client, guild, { userId: objetivo.id, staffId: user.id, motivo, resultado });
        return interaction.editReply({
            content:
                `⚠️ Aviso #${resultado.id} a <@${objetivo.id}>. Lleva **${resultado.vigentes}** strikes vigentes.\n` +
                (dm ? "📩 Le ha llegado el DM." : "📪 No se le pudo mandar el DM (¿los tiene cerrados?).") +
                (resultado.umbral
                    ? `\n🚨 Ha llegado al umbral de **${resultado.umbral.texto}**: es una sugerencia, decide el staff.` +
                      (admins ? ` Avisados ${admins} admins.` : "")
                    : ""),
            allowedMentions: { parse: [] },
        });
    },
};
