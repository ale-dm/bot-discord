// Caso de uso del blackjack (#474): las estadísticas del jugador, para que el manejador del split no consulte la
// base de datos directamente.
const repo = require("../../repositorios/casino");

/** Las estadísticas de blackjack de `userId` (partidas, ganadas, beneficio…). */
function estadisticasBlackjack(userId) {
    return repo.estadisticasBlackjack(userId);
}

module.exports = { estadisticasBlackjack };
