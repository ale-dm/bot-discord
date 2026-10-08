// 🔊 /sonidos: el panel de sonidos del servidor (como el de Discord). Sin opciones abre el panel, público, para que cualquiera
// pulse. Un admin (Gestionar servidor) puede subir un sonido (archivo + nombre) o borrar uno (borrar:nombre).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createLogger } = require("../../core/logger");
const sonidos = require("../../systems/sonidos");
const { pantallaSonidos } = require("../../paneles/sonidos");

const log = createLogger("Sonidos");
const efimero = (texto) => ({ content: texto, flags: MessageFlags.Ephemeral });
const esAdmin = (interaction) => Boolean(interaction.memberPermissions?.has?.("ManageGuild"));

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["sonido_"], method: "handleButton", acl: "sonidos" }],
    data: new SlashCommandBuilder()
        .setName("sonidos")
        .setDescription("🔊 Panel de sonidos: pulsa uno y el bot lo reproduce en tu canal de voz")
        .addAttachmentOption((o) =>
            o.setName("archivo").setDescription("Admin: el sonido a añadir (mp3, ogg o wav, hasta 1 MB)").setRequired(false),
        )
        .addStringOption((o) =>
            o.setName("nombre").setDescription("Admin: cómo se llama el sonido (hasta 32 caracteres)").setRequired(false).setMaxLength(32),
        )
        .addStringOption((o) =>
            o.setName("borrar").setDescription("Admin: nombre del sonido a borrar").setRequired(false).setMaxLength(32),
        ),

    async run(client, interaction) {
        const archivo = interaction.options.getAttachment("archivo");
        const nombre = interaction.options.getString("nombre");
        const borrar = interaction.options.getString("borrar");

        if (archivo || borrar) {
            if (!esAdmin(interaction))
                return interaction.reply(efimero("⛔ Solo un admin (Gestionar servidor) puede cambiar los sonidos."));
            if (borrar) {
                const ok = sonidos.borrarPorNombre(interaction.guildId, borrar);
                return interaction.reply(
                    efimero(ok ? `🗑️ Borrado **${borrar.trim()}**.` : `No hay ningún sonido que se llame «${borrar.trim()}».`),
                );
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await sonidos.guardar(interaction.guildId, {
                nombre: nombre || archivo.name.replace(/\.[^.]+$/, ""),
                archivo: { nombreArchivo: archivo.name, url: archivo.url, tamano: archivo.size },
                userId: interaction.user.id,
            });
            if (!r.ok) return interaction.editReply(`❌ ${r.motivo}`);
            log.info(`${interaction.user.tag} añadió el sonido «${r.sonido.nombre}» en ${interaction.guildId}`);
            return interaction.editReply(`✅ Sonido **${r.sonido.nombre}** añadido. Ya sale en el panel.`);
        }

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
        const canal = interaction.member?.voice?.channel;
        if (!canal) return interaction.reply(efimero("🔊 Entra primero en un canal de voz."));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await sonidos.reproducir(canal, sonido);
        return interaction.editReply(r.ok ? `🔊 Sonando **${sonido.nombre}** en ${canal.name}.` : `❌ ${r.motivo}`);
    },
};
