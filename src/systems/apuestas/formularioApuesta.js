// Reglas del formulario de apuesta a un partido (juegos/apuestas/apuestas.js): qué elección codifica cada botón, qué
// cuota le toca, qué cantidad vale, qué marcador escribe quien apuesta al exacto y si la apuesta se cobra. Sin Discord:
// los avisos al usuario los decide juegos/apuestas/apuestas.js.
const dinero = require("../dinero");
const marcadorExacto = require("./marcador");
const mercados = require("./mercados");
const directo = require("./directo");
const limites = require("./limites");
const { cuotaDeEleccion, cobrarApuesta, yaApostadoApuesta, partidoPorMatch } = require("./apostar");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);

// Botones de 1X2 y de marcador exacto: apuesta_{home|draw|away|exacto}_{match_id}.
const BOTONES_ELECCION = { apuesta_home_: "home", apuesta_draw_: "draw", apuesta_away_: "away", apuesta_exacto_: "exacto" };
const PREFIJO_MERCADO = "apuesta_mercado_";

/** ¿Vale la cantidad? Entre MIN_BET_AMOUNT y MAX_BET_AMOUNT (y no es un número inválido). */
function cantidadValida(cantidad) {
    return !isNaN(cantidad) && cantidad >= MIN_BET_AMOUNT && cantidad <= MAX_BET_AMOUNT;
}

/**
 * La elección y el partido que codifica el id de un botón de apuesta, o null si no es uno de apostar.
 * Los mercados de goles y de hándicap (#9, #10) son apuesta_mercado_{mas|menos|casa|fuera}_{match_id}.
 */
function eleccionDeBoton(customId) {
    const prefijo = Object.keys(BOTONES_ELECCION).find((p) => customId.startsWith(p));
    if (prefijo) return { eleccion: BOTONES_ELECCION[prefijo], matchId: customId.slice(prefijo.length) };
    if (!customId.startsWith(PREFIJO_MERCADO)) return null;

    const resto = customId.slice(PREFIJO_MERCADO.length);
    const corte = resto.indexOf("_");
    const eleccion = resto.slice(0, corte);
    if (!mercados.esMercado(eleccion)) return null;
    return { eleccion, matchId: resto.slice(corte + 1) };
}

/** La cuota con la que se apostaría con ese botón. Null si no hay partido o no tiene cuota para esa elección. */
function cuotaDeBoton(eleccion, match) {
    if (!match) return null;
    // 🎯 Marcador exacto (F-AP-10): sin cuota de la API, premio fijo.
    if (eleccion === "exacto") return marcadorExacto.PREMIO;
    return cuotaDeEleccion(eleccion, match);
}

/** La línea que se guarda con la apuesta: solo los mercados de goles y de hándicap tienen una. */
function lineaDeApuesta(eleccion, match) {
    return mercados.esMercado(eleccion) ? mercados.lineaDe(match, eleccion) : null;
}

/** La elección ("exacto_2-1") de los goles que se escriben en el formulario, o null si alguno no es válido. */
function eleccionExacta(golesLocalTexto, golesVisitanteTexto) {
    const golesLocal = marcadorExacto.golesValidos(golesLocalTexto);
    const golesVisitante = marcadorExacto.golesValidos(golesVisitanteTexto);
    if (golesLocal === null || golesVisitante === null) return null;
    return marcadorExacto.eleccion(golesLocal, golesVisitante);
}

const rechazo = (motivo, datos = {}) => ({ motivo, ...datos });

/**
 * Comprueba una apuesta a un partido y la cobra si pasa todo, en este orden: cantidad, saldo, partido, partido abierto,
 * cuota, duplicado y tope diario. Es síncrona a propósito: el duplicado, el tope y el cobro van seguidos y sin await por
 * medio, así que dos formularios a la vez no pueden apostar dos veces ni pasarse del límite entre los dos.
 * Devuelve { motivo: null, ...apuesta } si se ha cobrado, o { motivo, ... } con el motivo del rechazo (sin cobrar).
 */
function apostarAPartido({ userId, guildId, matchId, eleccion, cantidad }) {
    if (!cantidadValida(cantidad)) return rechazo("cantidad");
    // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino). Se apuesta con el 💵 efectivo +
    // 🥷 dinero negro (systems/dinero, F-EC-06b: se gasta igual).
    if (dinero.saldoGastable(userId) < cantidad) return rechazo("sinEfectivo");

    const match = partidoPorMatch(matchId);
    if (!match) return rechazo("sinPartido");
    // El formulario se puede abrir desde un mensaje antiguo: sin esta comprobación se podía apostar a un partido
    // ya empezado (o terminado) sabiendo cómo iba.
    if (!directo.abiertoParaApostar(match)) return rechazo("cerrado", { match });

    // La línea de la apuesta queda guardada: si la API la cambia después, esta apuesta se liquida con la suya.
    const cuota = cuotaDeEleccion(eleccion, match);
    if (!cuota || cuota < 1) return rechazo("cuota");

    if (yaApostadoApuesta(userId, matchId, eleccion)) return rechazo("duplicada", { eleccion });
    // 🚦 Tope diario y máximo por partido del servidor (F-AP-09).
    const limite = limites.comprobar(guildId, userId, cantidad, { matchId });
    if (limite) return rechazo("limite", { limite });

    const linea = lineaDeApuesta(eleccion, match);
    if (!cobrarApuesta({ userId, match_id: matchId, match, eleccion, cantidad, cuota, linea })) return rechazo("sinEfectivo");
    return { motivo: null, userId, match, eleccion, cantidad, cuota, linea };
}

module.exports = {
    MIN_BET_AMOUNT,
    MAX_BET_AMOUNT,
    cantidadValida,
    eleccionDeBoton,
    cuotaDeBoton,
    lineaDeApuesta,
    eleccionExacta,
    apostarAPartido,
};
