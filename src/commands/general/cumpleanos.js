// 🎂 /cumpleaños: guarda el día y el mes de tu cumpleaños (sin año) para que el bot te felicite en el canal de avisos con una
// mención; `ver` enseña los próximos cinco del servidor y `borrar` quita el tuyo. La felicitación la publica un cron
// (systems/cumpleanos.felicitarSiToca); el canal se elige en /paneladmin → ⚙️ Config Global → 📣 Comunidad.
const { SlashCommandBuilder } = require("discord.js");
const cumpleanos = require("../../systems/cumpleanos");
const { momentoMadrid } = require("../../core/zonaMadrid");
const { efimero } = require("../../core/respuestas");

/** «<@id> · 14 de octubre (hoy)» / «(mañana)» / «(en 5 días)». */
function lineaProximo(p) {
    const cuando = p.enDias === 0 ? "hoy" : p.enDias === 1 ? "mañana" : `en ${p.enDias} días`;
    return `<@${p.userId}> · ${cumpleanos.textoFecha(p.dia, p.mes)} (${cuando})`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("cumpleaños")
        .setDescription("🎂 Guarda tu cumpleaños para que te felicite, o mira los próximos")
        .addSubcommand((s) =>
            s
                .setName("fecha")
                .setDescription("Guarda el día y el mes de tu cumpleaños (sin año)")
                .addIntegerOption((o) => o.setName("dia").setDescription("Día del mes").setRequired(true).setMinValue(1).setMaxValue(31))
                .addIntegerOption((o) => o.setName("mes").setDescription("Mes (1 a 12)").setRequired(true).setMinValue(1).setMaxValue(12)),
        )
        .addSubcommand((s) => s.setName("ver").setDescription("Los próximos cinco cumpleaños del servidor"))
        .addSubcommand((s) => s.setName("borrar").setDescription("Borra tu cumpleaños")),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (sub === "fecha") {
            const dia = interaction.options.getInteger("dia");
            const mes = interaction.options.getInteger("mes");
            const r = cumpleanos.guardar(userId, interaction.guildId, dia, mes);
            if (!r.ok) return interaction.reply(efimero(r.mensaje));
            return interaction.reply(
                efimero(`🎂 Guardado: tu cumpleaños es el **${cumpleanos.textoFecha(dia, mes)}**. Te felicitaré ese día.`),
            );
        }
        if (sub === "borrar") {
            return interaction.reply(
                efimero(
                    cumpleanos.borrar(userId, interaction.guildId)
                        ? "🗑️ He borrado tu cumpleaños."
                        : "No tenías ningún cumpleaños guardado.",
                ),
            );
        }
        const lista = cumpleanos.proximos(interaction.guildId, momentoMadrid(Date.now()), 5);
        if (!lista.length) return interaction.reply(efimero("Nadie ha guardado su cumpleaños todavía. Usa `/cumpleaños fecha`."));
        return interaction.reply({
            content: `🎂 **Próximos cumpleaños**\n${lista.map(lineaProximo).join("\n")}`,
            allowedMentions: { parse: [] },
        });
    },
};
