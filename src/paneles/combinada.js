// 🧩 Combinada (#1): el boleto que se va armando (privado, en un mensaje efímero) y las combinadas en juego.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const combinadas = require("../systems/apuestas/combinadas");
const mercados = require("../systems/apuestas/mercados");
const { fmtNumero } = require("../core/formato");

/** La pantalla del boleto en armado de alguien. `aviso`: una línea de resultado de la última acción. */
function pantallaCombinada(userId, aviso = null) {
    const patas = combinadas.borrador(userId);
    const cuota = patas.length ? combinadas.cuotaTotal(patas.map((p) => p.cuota)) : 0;
    const enJuego = combinadas.de(userId);

    const lineas = patas.map(
        (p, i) =>
            `${i + 1}. **${mercados.textoEleccion({ ...p.partido, eleccion: p.eleccion, linea: p.linea })}** · ` +
            `${p.partido.home_team} vs ${p.partido.away_team} · cuota \`${p.cuota}\``,
    );
    const resumen = !patas.length
        ? "Todavía no has sumado ningún partido. En un partido de ⚽ Apuestas, elige **🧩 Sumar a mi combinada**."
        : patas.length < combinadas.MIN_PATAS
          ? `${lineas.join("\n")}\n\nHacen falta al menos **${combinadas.MIN_PATAS}** partidos.`
          : `${lineas.join("\n")}\n\n**Cuota total:** \`${cuota}\` · con **100** monedas cobrarías **${fmtNumero(combinadas.premioDe(100, cuota))}** 🪙`;

    const embed = new EmbedBuilder()
        .setTitle("🧩 Tu combinada")
        .setDescription((aviso ? `${aviso}\n\n` : "") + resumen)
        .setColor(0x9b59b6)
        .setFooter({ text: `De ${combinadas.MIN_PATAS} a ${combinadas.MAX_PATAS} partidos; se gana solo si aciertas todos.` });
    if (enJuego.length) {
        embed.addFields({
            name: "⏳ Tus combinadas en juego",
            value: enJuego
                .map(
                    (c) =>
                        `**${fmtNumero(c.cantidad)}** 🪙 · cuota \`${c.cuota}\` · ${c.patas.length} partidos · cobrarías **${fmtNumero(combinadas.premioDe(c.cantidad, c.cuota))}** 🪙`,
                )
                .join("\n")
                .slice(0, 1024),
        });
    }

    const filas = [];
    if (patas.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                ...patas.map((p, i) =>
                    new ButtonBuilder()
                        .setCustomId(`combinada_quitar_${p.matchId}`)
                        .setLabel(`✖ Quitar ${i + 1}`)
                        .setStyle(ButtonStyle.Secondary),
                ),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("combinada_apostar")
                .setLabel("💰 Apostar combinada")
                .setStyle(ButtonStyle.Success)
                .setDisabled(patas.length < combinadas.MIN_PATAS),
            new ButtonBuilder()
                .setCustomId("combinada_vaciar")
                .setLabel("🗑️ Vaciar")
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!patas.length),
            new ButtonBuilder().setCustomId("combinada_ver").setLabel("🔄 Actualizar").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas };
}

module.exports = { pantallaCombinada };
