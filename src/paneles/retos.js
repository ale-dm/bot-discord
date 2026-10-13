// Pestaña "⚔️ Retos" de /juegos y los mensajes públicos de cada reto: lo que tienes pendiente y en juego, los pasos
// para lanzar uno (partido, duelo o porra) y cómo se ve cada reto según su estado. Solo construye mensajes; los
// botones están en juegos/retos/retos.js y las reglas en systems/retos.js. Este fichero es la fachada de los retos*.js
// de esta carpeta: quien importa de aquí no tiene que saber en cuál está cada pantalla.
const { buildRetos, buildBloqueos } = require("./retosPestana");
const {
    buildElegirPartido,
    buildElegirLado,
    buildElegirJuego,
    buildElegirRival,
    modalCantidad,
    modalPorra,
    CAMPO_SERIE,
} = require("./retosPasos");
const { mensajeReto, ladoTexto, contrarioTexto } = require("./retosMensaje");
const { vistaManoBlackjack, elegirGanadoraPorra, elegirRivalCaraACara, vistaCaraACara } = require("./retosPrivados");
const { persona } = require("./retosComun");

module.exports = {
    buildRetos,
    buildBloqueos,
    buildElegirPartido,
    buildElegirLado,
    buildElegirJuego,
    buildElegirRival,
    modalCantidad,
    modalPorra,
    CAMPO_SERIE,
    mensajeReto,
    vistaManoBlackjack,
    elegirGanadoraPorra,
    elegirRivalCaraACara,
    vistaCaraACara,
    ladoTexto,
    contrarioTexto,
    persona,
};
