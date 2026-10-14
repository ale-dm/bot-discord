// 🖼️ /imagenes: las últimas 10 imágenes que has generado con /imagen (y a un admin, las del servidor), con el enlace al mensaje. Solo
// lo ves tú. El historial guarda enlaces, no las imágenes; se conserva 90 días (systems/duende/imagenes).
const { SlashCommandBuilder } = require("discord.js");
const imagenes = require("../../systems/duende/imagenes");
const { esAdmin } = require("../../core/permisos");
const { efimero } = require("../../discord/respuestas");

const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

function linea(f, conAutor) {
    const cuando = `<t:${Math.floor(f.creada_en / 1000)}:R>`;
    const enlace = f.url ? `[ver](${f.url})` : f.adjunto ? `[imagen](${f.adjunto})` : "sin enlace";
    return `• ${cuando}${conAutor ? ` · <@${f.userId}>` : ""} — ${corto(f.prompt.replace(/\s+/g, " "), 90)}${f.estilo ? ` _(${f.estilo.split(",")[0]})_` : ""} · ${enlace}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("imagenes")
        .setDescription("🖼️ Tus últimas imágenes generadas con /imagen (un admin ve las del servidor)"),

    async run(client, interaction) {
        const delServidor = Boolean(interaction.guildId) && esAdmin(interaction);
        const filas = imagenes.ultimas(delServidor ? { guildId: interaction.guildId } : { userId: interaction.user.id });
        if (!filas.length) {
            return interaction.reply(
                efimero(
                    delServidor
                        ? "Nadie ha generado imágenes en este servidor todavía."
                        : "Todavía no has generado ninguna imagen con `/imagen`.",
                ),
            );
        }
        return interaction.reply({
            ...efimero(
                `🖼️ **${delServidor ? "Últimas imágenes del servidor" : "Tus últimas imágenes"}**\n${filas.map((f) => linea(f, delServidor)).join("\n")}`,
            ),
            allowedMentions: { parse: [] },
        });
    },
};
