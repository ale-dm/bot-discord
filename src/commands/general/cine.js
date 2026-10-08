// 🎬 /cine peli hora: convoca una sesión de cine con botones para apuntarse (#24). Ver systems/cine.js.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const cine = require("../../systems/cine");
const { pantallaSesion } = require("../../paneles/cine");

const efimero = (texto) => ({ content: texto, flags: MessageFlags.Ephemeral });

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["cine_"], method: "handleButton", acl: "cine" }],
    data: new SlashCommandBuilder()
        .setName("cine")
        .setDescription("🎬 Convoca una sesión de cine: quien quiera se apunta con un botón")
        .addStringOption((o) => o.setName("peli").setDescription("Qué vais a ver").setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName("hora").setDescription("A qué hora, en hora de Madrid (p. ej. 21:30)").setRequired(true)),

    async run(client, interaction) {
        const peli = interaction.options.getString("peli").trim();
        const inicio = cine.proximaHora(interaction.options.getString("hora"));
        if (!inicio) {
            return interaction.reply(efimero("❌ La hora tiene que ser HH:MM, en 24 horas (p. ej. 21:30)."));
        }
        const id = cine.crear({
            guildId: interaction.guildId,
            canalId: interaction.channelId,
            organizador: interaction.user.id,
            peli,
            inicio,
        });
        await interaction.reply({ ...pantallaSesion(id), fetchReply: true });
        const mensaje = await interaction.fetchReply();
        cine.guardarMensaje(id, mensaje.id);
    },

    async handleButton(client, interaction) {
        const [, accion, id] = /^cine_(\w+?)_(\d+)$/.exec(interaction.customId) || [];
        const s = cine.sesion(id);
        if (!s) return interaction.reply(efimero("Esa sesión ya no existe."));
        const userId = interaction.user.id;

        if (accion === "apuntarse") {
            if (s.cancelada) return interaction.reply(efimero("Esa sesión está cancelada."));
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
            if (!r.ok) return interaction.reply(efimero(r.mensaje));
            return interaction.update(pantallaSesion(id));
        }
    },
};
