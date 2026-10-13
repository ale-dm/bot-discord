// Mensajes privados de los retos: tu mano de un blackjack (solo la ves tú) y el menú de admins para decir qué opción
// de una porra ha ganado.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const retos = require("../systems/retos");
const { fmtNumero } = require("../core/formato");
const { COLOR, corto, manoTexto, persona } = require("./retosComun");
const { UserSelectMenuBuilder } = require("discord.js");

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
    const acciones = plantado
        ? []
        : [
              new ButtonBuilder().setCustomId(`retos_bj_pedir_${reto.id}`).setLabel("🃏 Pedir").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`retos_bj_plantar_${reto.id}`).setLabel("✋ Plantarse").setStyle(ButtonStyle.Secondary),
          ];
    // Doblar (#444): solo con las dos primeras cartas; pone otra vez lo mismo, da una carta más y planta la mano.
    if (!plantado && (reto.datos.manos[yo] || []).length === 2) {
        acciones.push(
            new ButtonBuilder()
                .setCustomId(`retos_bj_doblar_${reto.id}`)
                .setLabel(`✖️2 Doblar (${fmtNumero(reto.cantidad)} 🪙)`)
                .setStyle(ButtonStyle.Danger),
        );
    }
    return { embeds: [embed], components: acciones.length ? [new ActionRowBuilder().addComponents(acciones)] : [] };
}

/** Elegir con quién ver el cara a cara (#437): un selector de una persona (mensaje privado). */
function elegirRivalCaraACara() {
    return {
        content: "🆚 ¿Con quién quieres ver tu cara a cara?",
        components: [
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder().setCustomId("retos_cara_sel").setPlaceholder("Elige a alguien").setMinValues(1).setMaxValues(1),
            ),
        ],
    };
}

const signo = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNumero(Math.abs(n))}`;

/** El cara a cara entre `a` (quien lo mira) y `b` (#437): victorias de cada uno, beneficio neto y los últimos retos resueltos entre ambos. */
function vistaCaraACara(a, b, resumen) {
    const embed = new EmbedBuilder().setTitle("🆚 Cara a cara").setColor(0xe67e22);
    if (!resumen.total) {
        embed.setDescription(`Todavía no habéis resuelto ningún reto ${persona(a)} y ${persona(b)}.`);
        return { embeds: [embed], components: [] };
    }
    const ultimos = resumen.ultimos.map((r) => {
        const ganador = r.participantes.find((p) => p.premio > 0)?.userId;
        const tipo =
            r.tipo === "duelo" ? `${retos.JUEGOS[r.juego]?.emoji || "🎲"} ${retos.JUEGOS[r.juego]?.nombre || r.juego}` : "⚽ Partido";
        return `#${r.id} · ${tipo} · ${fmtNumero(r.cantidad)} 🪙 · gana ${persona(ganador)}`;
    });
    embed.setDescription(
        `${persona(a)} **${resumen.victoriasA}** – **${resumen.victoriasB}** ${persona(b)} (${resumen.total} ${resumen.total === 1 ? "reto" : "retos"} resueltos)\n` +
            `💰 Beneficio neto de ${persona(a)} contra ${persona(b)}: **${signo(resumen.netoA)}** 🪙\n\n` +
            `**Últimos ${ultimos.length}**\n${ultimos.join("\n")}\n\n_Los retos devueltos no cuentan._`,
    );
    return { embeds: [embed], components: [] };
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

module.exports = { vistaManoBlackjack, elegirGanadoraPorra, elegirRivalCaraACara, vistaCaraACara };
