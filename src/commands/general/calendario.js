// 📅 /calendario (#540): lo que hay programado en el servidor (cine, cumpleaños, partidos, quinielas y eventos de los admins)
// por semanas o por meses, con navegación y el detalle de cada evento. Es privado: cada uno navega sin llenar el canal.
// Los eventos manuales y los recordatorios se configuran en /paneladmin → ⚙️ Config Global → 📅 Calendario.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const calendario = require("../../systems/calendario");
const { vista, detalle } = require("../../paneles/calendario");

const MAX_OFFSET = 52;

/** «sem_-1» → { modo: "sem", offset: -1 }, acotado a un año arriba o abajo. */
function leerVista(texto) {
    const m = /^(sem|mes)_(-?\d+)$/.exec(texto);
    if (!m) return null;
    return { modo: m[1], offset: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Number(m[2]))) };
}

module.exports = {
    data: new SlashCommandBuilder().setName("calendario").setDescription("📅 Lo que hay programado: cine, cumpleaños, partidos y eventos"),

    componentHandlers: [
        { types: ["button"], prefixes: ["calendario_ver_"], method: "handleButton", acl: "calendario" },
        { types: ["stringSelect"], prefixes: ["calendario_det_"], method: "handleSelect", acl: "calendario" },
    ],

    async run(client, interaction) {
        if (!interaction.guildId)
            return interaction.reply({ content: "Esto solo funciona en un servidor.", flags: MessageFlags.Ephemeral });
        return interaction.reply({ ...vista(interaction.guildId), flags: MessageFlags.Ephemeral });
    },

    async handleButton(client, interaction) {
        const v = leerVista(interaction.customId.slice("calendario_ver_".length));
        if (!v) return undefined;
        return interaction.update(vista(interaction.guildId, v));
    },

    async handleSelect(client, interaction) {
        const v = leerVista(interaction.customId.slice("calendario_det_".length));
        if (!v) return undefined;
        const rango = v.modo === "mes" ? calendario.rangoMes(Date.now(), v.offset) : calendario.rangoSemana(Date.now(), v.offset);
        const e = calendario.eventos(interaction.guildId, rango.desde, rango.hasta).find((x) => x.clave === interaction.values[0]);
        if (!e) return interaction.reply({ content: "Ese evento ya no está en el calendario.", flags: MessageFlags.Ephemeral });
        return interaction.reply({ ...detalle(e), flags: MessageFlags.Ephemeral });
    },
};
