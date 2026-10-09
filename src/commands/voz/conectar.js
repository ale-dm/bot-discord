// 🔌 /conectar: el bot entra a un canal de voz y se queda 30 minutos, para que /sonidos suene sin entrar y salir cada vez.
// Sin canal: si ya está conectado, se sale; si no, entra al canal de quien lo pide. Ver systems/presencia.js.
const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const presencia = require("../../systems/presencia");
const { efimero } = require("../../core/respuestas");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("conectar")
        .setDescription("🔌 Entra a un canal de voz 30 minutos, para que /sonidos suene sin entrar y salir")
        .addChannelOption((o) =>
            o
                .setName("canal")
                .setDescription("El canal de voz (por defecto, el tuyo; sin canal y ya conectado, me salgo)")
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false),
        ),

    async run(client, interaction) {
        const elegido = interaction.options.getChannel("canal");
        if (!elegido && presencia.actual(interaction.guildId)) {
            presencia.desconectar(interaction.guildId);
            return interaction.reply(efimero("🔌 Me he salido del canal."));
        }
        const canal = elegido || interaction.member?.voice?.channel;
        if (!canal) return interaction.reply(efimero("🔌 Entra a un canal de voz, o elige uno en la opción *canal*."));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await presencia.conectar(canal);
        if (!r.ok) return interaction.editReply(`❌ ${r.motivo}`);
        const hasta = Math.floor(r.expira / 1000);
        return interaction.editReply(
            `🔌 Conectado a **${r.canal}**. Me quedo hasta <t:${hasta}:t> (unos ${presencia.MINUTOS} minutos): ya puedes usar /sonidos.`,
        );
    },
};
