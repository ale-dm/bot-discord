// Blackjack: separar (split) una mano en dos. Cobrar la segunda apuesta, jugar cada mano y liquidarlas por separado. El flujo de
// la partida está en ./blackjack, y lo común de la mesa en ./blackjackMesa.
const { EmbedBuilder, MessageFlags } = require("discord.js");
const repo = require("../../repositorios/casino");
const bj = require("../../systems/blackjack");
const { liquidarManoSplit } = require("../../systems/blackjackCobros");
const { terminarPartida, cobrarExtra } = require("./blackjackMesa");
const { COLOR, cartas, filaFin, textoManoSplit, filaSplit, embedSiguienteMano, embedResumenSplit } = require("./blackjackVista");

const { handValue } = bj;

// Liquida cada mano del split por separado. Devuelve el recuento para el resumen, o null si un cobro falla
// (en ese caso ya se ha respondido y la partida está cerrada).
async function liquidarManosSplit(interaction, state, userId, botVal, manos) {
    let totalGanancia = 0;
    let resultadosTexto = "";
    let manosGanadas = 0;
    let manosEmpate = 0;

    for (const [i, mano] of manos.entries()) {
        const n = i + 1;
        const r = liquidarManoSplit(userId, interaction.guildId, state, mano, n, botVal);
        if (!r.exito) {
            await interaction.update({
                content: `❌ Error procesando resultado de mano ${n}. Contacta un administrador.`,
                embeds: [],
                components: [],
            });
            terminarPartida(userId);
            return null;
        }
        totalGanancia += r.cobro;
        resultadosTexto += `**Mano ${n}:** ${cartas(mano.cartas)} (**${mano.valor}**) - ${textoManoSplit(mano, botVal)}\n`;
        if (mano.resultado === "gana") manosGanadas++;
        else if (mano.resultado === "empate") manosEmpate++;
    }
    return { totalGanancia, resultadosTexto, manosGanadas, manosEmpate };
}

// Estadísticas de blackjack del jugador (para el resumen de un split).
function estadisticasBJ(userId) {
    return repo.estadisticasBlackjack(userId);
}

// Fin del split: juega el crupier, se liquida cada mano por separado y se enseña el resumen.
async function evaluarSplitFinal(interaction, state, userId) {
    const { botVal, manos } = bj.resolverSplit(state);
    const liquidado = await liquidarManosSplit(interaction, state, userId, botVal, manos);
    if (!liquidado) return;

    const embed = embedResumenSplit(state, estadisticasBJ(userId), { botVal, ...liquidado });
    await interaction.update({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

// Separar: cobra lo extra y reparte la segunda mano (con dos ases se resuelve directamente).
async function botonSeparar(interaction, state, userId) {
    if (!state.puedeSplit) {
        await interaction.reply({ content: "No puedes separar ahora.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!(await cobrarExtra(interaction, state))) return;
    // Con dos ases solo se reparte una carta a cada mano y se resuelve directamente.
    if (bj.separar(state).sonAses) {
        await evaluarSplitFinal(interaction, state, userId);
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle("🃏 Blackjack - Mano 1 (Separada)")
        .setDescription(
            `**Mano 1:** ${cartas(state.hands[0])} (**${handValue(state.hands[0])}**)\n` +
                `**Mano 2:** ${state.hands[1][0].display} + ?\n\n` +
                `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                "Juega tu primera mano.",
        )
        .setColor(COLOR.juego);
    await interaction.update({ embeds: [embed], components: [filaSplit()] });
}

// Pedir o plantarse en una de las dos manos del split.
async function botonSplit(interaction, state, userId, id) {
    if (!state.split) {
        await interaction.reply({ content: "No estás en modo split.", flags: MessageFlags.Ephemeral });
        return;
    }
    const pide = id === "bj_hit_split";
    const r = pide ? bj.pedirSplit(state) : bj.plantarseSplit(state);
    if (r.terminado) {
        await evaluarSplitFinal(interaction, state, userId);
    } else if (pide && !r.pasada) {
        // Sigue en la misma mano.
        const embed = new EmbedBuilder()
            .setTitle(`🃏 Blackjack - Mano ${state.currentHand + 1} (Separada)`)
            .setDescription(
                `Tus cartas: ${cartas(state.hands[state.currentHand])} (**${r.valor}**)\n` +
                    `Carta visible del crupier: ${state.botHand[0].display}\n\n` +
                    "¿Qué quieres hacer?",
            )
            .setColor(COLOR.juego);
        await interaction.update({ embeds: [embed], components: [filaSplit()] });
    } else {
        await interaction.update({
            embeds: [embedSiguienteMano(state, pide ? "¡Se pasó!" : "Plantado")],
            components: [filaSplit()],
        });
    }
}

module.exports = { botonSeparar, botonSplit };
