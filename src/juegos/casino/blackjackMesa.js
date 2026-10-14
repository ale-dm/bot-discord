// Lo común de la mesa de blackjack: las partidas en curso, cerrar una, cobrar una apuesta extra (doblar, separar) y liquidar un
// blackjack natural. Lo usan juegos/casino/blackjack y juegos/casino/blackjackSplit.
const { MessageFlags } = require("discord.js");
const activeGames = require("../../systems/activeGames");
const { cobrarExtraBJ, cobrarNatural } = require("../../systems/blackjackCobros");
const { ERROR_RESULTADO, embedNatural, filaFin } = require("./blackjackVista");

// Partidas en curso: userId -> estado. El dinero apostado se registra además en
// activeGames para poder devolverlo si el bot se reinicia a mitad de partida.
const partidasBJ = {};

function terminarPartida(userId) {
    delete partidasBJ[userId];
    activeGames.cerrar(userId, "blackjack");
}

// Cobra la apuesta extra de doblar o separar (parte de la misma jugada: sin mínimo ni cooldown).
async function cobrarExtra(interaction, state) {
    const resultado = cobrarExtraBJ(interaction.user.id, interaction.guildId, state.apuesta);
    if (!resultado.exito) {
        await interaction.reply({ content: resultado.mensaje, flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

// Blackjack natural al repartir (o al decidir el seguro): se liquida y se responde en el acto. `editar`: se responde sobre el
// mensaje de la partida (un botón) en vez de con uno nuevo; `nota` es lo que se añade (el seguro).
async function responderNatural(interaction, state, tipo, { editar = false, nota = "" } = {}) {
    const userId = interaction.user.id;
    const { exito, cobro } = cobrarNatural(userId, interaction.guildId, state, tipo);
    const embed = embedNatural(tipo, state, cobro);
    if (nota) embed.addFields({ name: "🛡️ Seguro", value: nota });
    // Si el cobro falla, la partida termina igual: si no, el jugador queda bloqueado con una mano en memoria.
    if (!exito) {
        terminarPartida(userId);
        await interaction.reply({ content: ERROR_RESULTADO, flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction[editar ? "update" : "reply"]({ embeds: [embed], components: [filaFin(state)] });
    terminarPartida(userId);
}

module.exports = { partidasBJ, terminarPartida, cobrarExtra, responderNatural };
