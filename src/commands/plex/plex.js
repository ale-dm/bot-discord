// 🍿 /plex: un solo comando con botones para todo lo de Plex (como /tienda y /duende). Lo que hay debajo:
//   🎬 Sesión de cine (systems/cine) · 🎯 Para ti (systems/recomendaciones) · 🎞️ Wrapped (systems/plexWrapped) ·
//   🏅 Mi Plex (la pestaña de Plex de /perfil: horas, trofeos y logros).
const {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
} = require("discord.js");
const cine = require("../../systems/cine");
const recomendaciones = require("../../systems/recomendaciones");
const plexWrapped = require("../../systems/plexWrapped");
const plexLinks = require("../../systems/plexLinks");
const { pantallaSesion } = require("../../paneles/cine");
const { pantallaRecomendaciones } = require("../../paneles/recomendar");
const { pantallaPlex } = require("../../paneles/plex");
const perfilPaneles = require("../../paneles/perfil");

const efimero = (payload) => ({ ...payload, flags: MessageFlags.Ephemeral });

function formularioCine() {
    return new ModalBuilder()
        .setCustomId("plex_modal_cine")
        .setTitle("🎬 Sesión de cine")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("peli")
                    .setLabel("Qué vais a ver")
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("hora")
                    .setLabel("Hora (Madrid, HH:MM)")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("21:30")
                    .setMaxLength(5)
                    .setRequired(true),
            ),
        );
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["plex_", "cine_", "recomendar_pedir_"], method: "handleButton", acl: "plex" },
        { types: ["modal"], prefixes: ["plex_modal_"], method: "handleModal", acl: "plex" },
    ],
    data: new SlashCommandBuilder()
        .setName("plex")
        .setDescription("🍿 Plex: sesiones de cine, recomendaciones, tu Wrapped y tu perfil de Plex"),

    async run(client, interaction) {
        return interaction.reply(efimero(pantallaPlex(interaction.guildId, interaction.user.id)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // 🎬 Sesión de cine: el mensaje de la sesión (público) con sus botones.
        const cineBoton = /^cine_(\w+?)_(\d+)$/.exec(id);
        if (cineBoton) return handleCineBoton(interaction, cineBoton[1], cineBoton[2]);

        if (id === "plex_cine") return interaction.showModal(formularioCine());

        if (id === "plex_para_ti") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(pantallaRecomendaciones(await recomendaciones.generar(guildId, userId)));
        }

        const pedir = /^recomendar_pedir_(movie|tv)_(\d+)$/.exec(id);
        if (pedir) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await recomendaciones.pedir(guildId, userId, pedir[1], pedir[2]);
            return interaction.editReply({ content: r.ok ? "✅ Pedido en Seerr. Te avisaremos cuando esté en Plex." : `❌ ${r.mensaje}` });
        }

        if (id === "plex_wrapped") {
            // Privado: solo tu resumen, y solo a ti (el Wrapped no se publica en ningún canal).
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const link = plexLinks.getLinkByDiscordId(guildId, userId);
            if (!link) return interaction.editReply("Tu cuenta de Plex no está vinculada: el Wrapped es para quien la tiene vinculada.");
            const r = plexWrapped.resumenPersonal(guildId, link.tautulliUserId, plexWrapped.mesAnterior());
            const buf = plexWrapped.graficoPersonal(r);
            const files = buf ? [new AttachmentBuilder(buf, { name: "wrapped.png" })] : [];
            return interaction.editReply({ content: plexWrapped.mensajePersonal(r), files });
        }

        if (id === "plex_perfil") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(perfilPaneles.buildPlex(interaction.guild, userId, userId));
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId !== "plex_modal_cine") return;
        const peli = interaction.fields.getTextInputValue("peli").trim();
        const inicio = cine.proximaHora(interaction.fields.getTextInputValue("hora"));
        if (!inicio) return interaction.reply(efimero({ content: "❌ La hora tiene que ser HH:MM, en 24 horas (p. ej. 21:30)." }));
        const id = cine.crear({
            guildId: interaction.guildId,
            canalId: interaction.channelId,
            organizador: interaction.user.id,
            peli,
            inicio,
        });
        await interaction.reply(pantallaSesion(id));
        const mensaje = await interaction.fetchReply();
        cine.guardarMensaje(id, mensaje.id);
    },
};

/** Los botones de una sesión de cine (apuntarse, salirse, cancelar). */
async function handleCineBoton(interaction, accion, id) {
    const s = cine.sesion(id);
    if (!s) return interaction.reply(efimero({ content: "Esa sesión ya no existe." }));
    const userId = interaction.user.id;
    if (accion === "apuntarse") {
        if (s.cancelada) return interaction.reply(efimero({ content: "Esa sesión está cancelada." }));
        cine.apuntar(id, userId);
        return interaction.update(pantallaSesion(id));
    }
    if (accion === "salirse") {
        cine.salir(id, userId);
        return interaction.update(pantallaSesion(id));
    }
    if (accion === "cancelar") {
        const esAdmin = Boolean(interaction.memberPermissions?.has?.("ManageGuild"));
        const r = cine.cancelar(id, userId, esAdmin);
        if (!r.ok) return interaction.reply(efimero({ content: r.mensaje }));
        return interaction.update(pantallaSesion(id));
    }
}
