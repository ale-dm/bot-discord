// Piezas que comparten los demás ficheros de retos: el error de respuesta, el cobro que se queda sin efectivo, cómo
// se describe un reto, si alguien participa y el azar (inyectable en los tests con setRng).
const { JUEGOS, PPT, DUENDE } = require("./constantes");
const { partidoDe } = require("./persistencia");

let fuente = Math.random;
const azar = () => fuente();
const fijarAzar = (fn) => {
    fuente = fn || Math.random;
};

class SinEfectivo extends Error {}

const error = (mensaje) => ({ ok: false, mensaje });
const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

/** "Betis vs Sevilla", "duelo de Dados" o 'porra "¿llegará Jorge tarde?"': para el historial y los DMs. */
function descripcion(reto) {
    const contraDuende = reto.creador === DUENDE || reto.rival === DUENDE ? " contra el Duende" : "";
    if (reto.tipo === "partido") {
        const p = partidoDe(reto.match_id);
        return `${p ? `${p.home_team} vs ${p.away_team}` : "un partido"}${contraDuende}`;
    }
    if (reto.tipo === "duelo") return `duelo de ${JUEGOS[reto.juego]?.nombre || reto.juego}${contraDuende}`;
    return `porra "${corto(reto.pregunta || "", 60)}"`;
}

const esParticipante = (reto, userId) => reto.participantes.some((p) => p.userId === String(userId));

/** Una jugada de piedra-papel-tijera al azar (la del Duende). */
const jugadaAlAzar = () => Object.keys(PPT)[Math.min(2, Math.floor(azar() * 3))];

module.exports = { SinEfectivo, error, descripcion, esParticipante, jugadaAlAzar, azar, fijarAzar };
