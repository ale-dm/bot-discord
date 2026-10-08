// 🔊 /sonidos: el panel de sonidos del servidor (como el de Discord). Público: cualquiera pulsa un sonido y el bot lo toca.
// Los sonidos se suben y se borran desde /paneladmin → 🔊 Sonidos. Si el bot está en un canal por /conectar, suena ahí.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const sonidos = require("../../systems/sonidos");
const { pantallaSonidos } = require("../../paneles/sonidos");

const efimero = (texto) => ({ content: texto, flags: MessageFlags.Ephemeral });

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["sonido_"], method: "handleButton", acl: "sonidos" }],
    data: new SlashCommandBuilder().setName("sonidos").setDescription("🔊 Panel de sonidos: pulsa uno y el bot lo reproduce"),

    async run(client, interaction) {
        // El panel es público: cualquiera lo puede pulsar, y lo que pasa al pulsar se ve solo a quien lo pulsa.
        return interaction.reply({ ...pantallaSonidos(interaction.guildId, 0), fetchReply: true });
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const pagina = /^sonido_pagina_(\d+)$/.exec(id);
        if (pagina) return interaction.update(pantallaSonidos(interaction.guildId, Number(pagina[1])));

        const play = /^sonido_play_(\d+)$/.exec(id);
        if (!play) return;
        const sonido = sonidos.obtener(interaction.guildId, play[1]);
        if (!sonido) return interaction.reply(efimero("Ese sonido ya no existe."));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const canal = interaction.member?.voice?.channel ?? null;
        const r = await sonidos.reproducir(interaction.guildId, canal, sonido);
        const donde = canal ? canal.name : "el canal donde estoy";
        return interaction.editReply(r.ok ? `🔊 Sonando **${sonido.nombre}** en ${donde}.` : `❌ ${r.motivo}`);
    },
};
