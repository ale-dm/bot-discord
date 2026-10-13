// El embed del resumen semanal de admins (systems/resumenAdmin calcula los datos, #472).
const { EmbedBuilder } = require("discord.js");
const { fmtNumero } = require("../../core/formato");

function embedResumen({ ahora, desde, dias, e, c, g, odds, creditosAviso }) {
    const lineasErrores = e.lista.slice(0, 5).map((x) => `• ${x.veces}× ${x.texto}`);
    const embed = new EmbedBuilder()
        .setTitle("📊 Resumen semanal del bot")
        .setDescription(`Lo de los últimos ${dias} días (desde <t:${Math.floor(desde / 1000)}:f>).`)
        .addFields(
            {
                name: `❌ Errores: ${fmtNumero(e.total)}`,
                value: (e.total
                    ? lineasErrores.join("\n") + (e.lista.length > 5 ? `\n…y ${e.lista.length - 5} distintos más` : "")
                    : "Ninguno. 🎉"
                ).slice(0, 1024),
            },
            {
                name: `⌨️ Comandos más usados: ${fmtNumero(c.total)} en total`,
                value: c.total
                    ? c.lista
                          .slice(0, 5)
                          .map((x, i) => `${i + 1}. \`/${x.comando}\` · ${fmtNumero(x.veces)}`)
                          .join("\n")
                    : "Ninguno.",
            },
            {
                name: "🤖 Gemini",
                value:
                    `${fmtNumero(g.llamadas)} llamadas · ${fmtNumero(g.errores)} errores (${fmtNumero(g.cuotaAgotada)} por cuota) · tokens ` +
                    `${fmtNumero(g.tokensEntrada)} de entrada / ${fmtNumero(g.tokensSalida)} de salida` +
                    (g.desdeArranque ? `\n_Desde el arranque del bot, <t:${Math.floor(g.arranque / 1000)}:R>._` : ""),
            },
            {
                name: "⚽ Odds API",
                value:
                    odds.restantes === null
                        ? "Sin consultar desde el arranque."
                        : `**${fmtNumero(odds.restantes)}** créditos restantes este mes${odds.restantes < creditosAviso ? " ⚠️" : ""} (<t:${Math.floor(odds.at / 1000)}:R>)`,
            },
        )
        .setColor(e.total ? 0xe67e22 : 0x2ecc71)
        .setFooter({ text: "El Duende · llega a quien recibe las alertas (/paneladmin → 🩺 Sistema → 🔔 Alertas)" })
        .setTimestamp(ahora);
    if (e.principioPerdido || c.principioPerdido) {
        embed.addFields({ name: "ℹ️ Logs", value: "Los logs han rotado durante la semana: lo más antiguo puede faltar." });
    }
    return embed;
}

module.exports = { embedResumen };
