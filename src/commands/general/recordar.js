// ⏰ /recordar: te dejas un aviso propio (un texto y una hora) y el bot te lo manda por DM. `nuevo` lo crea, `lista` enseña los
// pendientes con un botón para borrar cada uno. Las reglas y el envío están en systems/recordarPersonal (cron cada minuto).
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const recordar = require("../../systems/recordarPersonal");
const { efimero } = require("../../discord/respuestas");

const cuando = (ms) => `<t:${Math.floor(ms / 1000)}:f> (<t:${Math.floor(ms / 1000)}:R>)`;

/** La lista de pendientes con un botón de borrar por cada uno (hasta 10: dos filas de 5). */
function pantallaLista(userId, aviso = "") {
    const lista = recordar.pendientes(userId);
    const contenido = lista.length
        ? lista.map((r, i) => `**${i + 1}.** ${cuando(r.cuando)} — ${r.texto}`).join("\n")
        : "No tienes ningún recordatorio pendiente. Crea uno con `/recordar nuevo`.";
    const filas = [];
    for (let i = 0; i < lista.length; i += 5) {
        filas.push(
            new ActionRowBuilder().addComponents(
                lista.slice(i, i + 5).map((r, j) =>
                    new ButtonBuilder()
                        .setCustomId(`recordar_borrar_${r.id}`)
                        .setLabel(`🗑️ ${i + j + 1}`)
                        .setStyle(ButtonStyle.Secondary),
                ),
            ),
        );
    }
    return {
        ...efimero(`${aviso ? `${aviso}\n\n` : ""}⏰ **Tus recordatorios**\n${contenido}`),
        components: filas,
        allowedMentions: { parse: [] },
    };
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["recordar_borrar_"], method: "handleButton" }],
    data: new SlashCommandBuilder()
        .setName("recordar")
        .setDescription("⏰ Déjate un aviso por DM a una hora (hasta 24 h)")
        .addSubcommand((s) =>
            s
                .setName("nuevo")
                .setDescription("Crea un recordatorio")
                .addStringOption((o) =>
                    o.setName("cuando").setDescription("18:30 · mañana 09:00 · en 45 min · en 2 h").setRequired(true).setMaxLength(30),
                )
                .addStringOption((o) =>
                    o.setName("texto").setDescription("Qué quieres que te recuerde").setRequired(true).setMaxLength(recordar.TEXTO_MAX),
                ),
        )
        .addSubcommand((s) => s.setName("lista").setDescription("Tus recordatorios pendientes (y borrarlos)")),

    async run(client, interaction) {
        const userId = interaction.user.id;
        if (interaction.options.getSubcommand() === "lista") return interaction.reply(pantallaLista(userId));
        const r = recordar.crear(userId, interaction.options.getString("cuando"), interaction.options.getString("texto"));
        return interaction.reply(efimero(r.mensaje));
    },

    async handleButton(client, interaction) {
        const id = Number(interaction.customId.replace("recordar_borrar_", ""));
        const ok = recordar.borrar(interaction.user.id, id);
        return interaction.update(pantallaLista(interaction.user.id, ok ? "🗑️ Borrado." : "Ese recordatorio ya no estaba."));
    },
};
