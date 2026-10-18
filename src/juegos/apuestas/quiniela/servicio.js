// Caso de uso de la quiniela (#474): orquesta las reglas (systems) y el repositorio, y devuelve datos listos para
// los manejadores. Los manejadores (quiniela.js, botones.js, vista.js) no consultan la base de datos: solo llaman
// aquí y traducen el resultado a un mensaje.
const repo = require("../../../repositorios/apuestas");
const { obtenerPartidosQuiniela, yaApostoQuiniela } = require("../../../systems/apuestas/quinielas");
const misJugadas = require("../../../systems/apuestas/misJugadas");

/** La quiniela abierta con ese id, o null. */
function quinielaAbierta(quinielaId) {
    return repo.quinielaAbierta(quinielaId);
}

/** ¿`userId` ya apostó en la quiniela `quinielaId`? */
function yaAposto(quinielaId, userId) {
    return yaApostoQuiniela(quinielaId, userId);
}

/**
 * La última quiniela abierta de un deporte con todo lo que necesita la vista: sus partidos, el bote y la jugada de
 * `userId` si ya apostó. null si no hay ninguna quiniela abierta.
 */
function datosDeVista(deporte, userId) {
    const quiniela = repo.ultimaQuinielaAbierta(deporte);
    if (!quiniela) return null;
    return {
        quiniela,
        partidos: obtenerPartidosQuiniela(quiniela.id),
        bote: repo.boteQuiniela(quiniela.id),
        tuya: misJugadas.quinielaDe(userId, quiniela.id),
    };
}

module.exports = { quinielaAbierta, yaAposto, datosDeVista };
