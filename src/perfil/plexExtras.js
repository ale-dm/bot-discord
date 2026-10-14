// Botones y menús plexx_* de /plex: 📡 viéndose ahora, 🗓️ estrenos de la semana, 🏆 campeones del ranking semanal, 📥 mis peticiones y el
// Wrapped del año. No es un comando: el router registra sus rutas igual que las de dinero.js. Las reglas están en systems/plexExtras.
const { MessageFlags, AttachmentBuilder } = require("discord.js");
const plexExtras = require("../systems/plexExtras");
const plexWrapped = require("../systems/plexWrapped");
const plexLinks = require("../systems/plexLinks");
const panel = require("../paneles/plexExtras");

/** El Wrapped del año anterior de quien lo pide (privado). */
async function wrappedAnual(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const link = plexLinks.getLinkByDiscordId(i.guildId, i.user.id);
    if (!link) return i.editReply("Tu cuenta de Plex no está vinculada: el Wrapped es para quien la tiene vinculada.");
    const r = plexWrapped.resumenPersonal(i.guildId, link.tautulliUserId, plexWrapped.anioAnterior());
    const buf = plexWrapped.graficoPersonal(r);
    return i.editReply({
        content: plexWrapped.mensajePersonal(r),
        files: buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : [],
    });
}

const BOTONES = {
    plexx_ahora: async (i) => {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        return i.editReply(panel.pantallaAhora(await plexExtras.reproduciendoAhora(i.guildId)));
    },
    plexx_estrenos: async (i) => {
        await i.deferUpdate();
        return i.editReply(panel.pantallaEstrenos(await plexExtras.estrenosDeLaSemana(i.guildId)));
    },
    plexx_campeones: async (i) => i.update(panel.pantallaCampeones(i.guildId)),
    plexx_pedidos: async (i) => {
        await i.deferUpdate();
        return i.editReply(panel.pantallaPedidos(await plexExtras.pedidosPendientes(i.guildId, i.user.id)));
    },
    plexx_wrapped_anio: wrappedAnual,
};

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["plexx_"], method: "handleButton", acl: "plex" },
        { types: ["stringSelect"], prefixes: ["plexx_"], method: "handleSelect", acl: "plex" },
    ],

    async handleButton(client, interaction) {
        const accion = BOTONES[interaction.customId];
        if (accion) return accion(interaction);
    },

    // El menú para cancelar una petición propia pendiente: se repinta la lista sin tener que volver a abrir /plex.
    async handleSelect(client, interaction) {
        if (interaction.customId !== "plexx_cancelar") return;
        await interaction.deferUpdate();
        const r = await plexExtras.cancelarPedido(interaction.guildId, interaction.user.id, Number(interaction.values[0]));
        const lista = await plexExtras.pedidosPendientes(interaction.guildId, interaction.user.id);
        return interaction.editReply(panel.pantallaPedidos(lista, r.ok ? r.mensaje : `❌ ${r.mensaje}`));
    },
};
