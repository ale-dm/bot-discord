// Mensajes privados de los retos: tu mano de un blackjack (solo la ves tú) y el menú de admins para decir qué opción
// de una porra ha ganado.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const retos = require("../systems/retos");
const { COLOR, corto, manoTexto } = require("./retosComun");

/** Tu mano de un duelo de blackjack (mensaje privado), con Pedir y Plantarse mientras juegas. */
function vistaManoBlackjack(reto, userId) {
    const yo = String(userId);
    const valor = retos.valorMano(reto, yo);
    const terminado = reto.estado !== "en_juego";
    const plantado = terminado || reto.datos.plantados[yo];
    const embed = new EmbedBuilder()
        .setTitle("🃏 Tu mano")
        .setDescription(
            `${manoTexto(reto, yo)}${valor > 21 ? "\n💥 Te has pasado." : ""}\n\n` +
                (terminado
                    ? "El duelo ha terminado: el resultado está en el mensaje del reto."
                    : plantado
                      ? "✋ Has terminado. Falta el otro."
                      : "¿Otra carta o te plantas? El otro no ve tu mano hasta el final."),
        )
        .setColor(terminado ? COLOR[reto.estado] : 0x3498db);
    const components = plantado
        ? []
        : [
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId(`retos_bj_pedir_${reto.id}`).setLabel("🃏 Pedir").setStyle(ButtonStyle.Primary),
                  new ButtonBuilder().setCustomId(`retos_bj_plantar_${reto.id}`).setLabel("✋ Plantarse").setStyle(ButtonStyle.Secondary),
              ),
          ];
    return { embeds: [embed], components };
}

/** Menú (privado, para admins) para decir qué opción de una porra ha ganado. */
function elegirGanadoraPorra(reto) {
    return {
        content: `⚖️ **${reto.pregunta}**\n¿Qué opción ha ganado? El bote se reparte entre los que la eligieron (si nadie la eligió, se devuelve).`,
        components: [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`retos_porra_ganadora_${reto.id}`)
                    .setPlaceholder("Opción ganadora")
                    .addOptions(
                        reto.opciones.map((opcion, n) => ({
                            label: corto(opcion, 100),
                            description: `${reto.participantes.filter((p) => p.opcion === String(n)).length} la eligieron`,
                            value: String(n),
                        })),
                    ),
            ),
        ],
    };
}

module.exports = { vistaManoBlackjack, elegirGanadoraPorra };
