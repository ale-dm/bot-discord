// 🎯 /recomendar: recomendaciones de Plex a partir de lo que has visto (#22). Solo las ves tú (efímero).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const recomendaciones = require("../../systems/recomendaciones");
const { pantallaRecomendaciones } = require("../../paneles/recomendar");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["recomendar_pedir_"], method: "handleButton", acl: "recomendar" }],
    data: new SlashCommandBuilder().setName("recomendar").setDescription("🎯 Qué ver en Plex, según lo que ya has visto"),

    async run(client, interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const resultado = await recomendaciones.generar(interaction.guildId, interaction.user.id);
        await interaction.editReply(pantallaRecomendaciones(resultado));
    },

    async handleButton(client, interaction) {
        const [, tipo, tmdbId] = /^recomendar_pedir_(movie|tv)_(\d+)$/.exec(interaction.customId) || [];
        if (!tipo) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await recomendaciones.pedir(interaction.guildId, interaction.user.id, tipo, tmdbId);
        await interaction.editReply({ content: r.ok ? "✅ Pedido en Seerr. Te avisaremos cuando esté en Plex." : `❌ ${r.mensaje}` });
    },
};
