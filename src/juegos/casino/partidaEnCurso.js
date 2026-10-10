// Una persona solo tiene una partida por juego en el casino (#237). Si la que hay sigue en curso, se avisa y quien
// llama tiene que parar; si estaba abandonada (más de 15 min sin tocar), se liquida y se puede empezar otra.
const { MessageFlags } = require("discord.js");
const activeGames = require("../../systems/activeGames");

/**
 * @param {object} interaction
 * @param {object|null} previa - la partida anterior de esta persona en este juego, si la hay
 * @param {string} juego - nombre que sale en el aviso, p. ej. "Blackjack"
 * @param {() => void} abandonar - liquida la partida abandonada
 * @returns {Promise<boolean>} true si ya hay una partida en curso (y se ha avisado)
 */
async function hayPartidaEnCurso(interaction, previa, juego, abandonar) {
    if (!previa) return false;
    if (!activeGames.estaAbandonada(previa.ultimaAccion)) {
        await interaction.reply({
            content: `🃏 Ya tienes una partida de ${juego} en curso. Termínala antes de empezar otra.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    abandonar();
    return false;
}

module.exports = { hayPartidaEnCurso };
