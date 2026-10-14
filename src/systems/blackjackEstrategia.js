// 💡 Estrategia básica del blackjack (#343): qué haría la tabla clásica con una mano y la carta visible del crupier. Es la de 4
// barajas, con el crupier plantándose en 17, doblar con cualquier mano de dos cartas y separar permitido (el juego del bot).
// Solo aconseja: no toca la partida. Las jugadas que el juego no permite en ese momento se sustituyen por la siguiente mejor.
const { handValue } = require("./blackjack");

const NOMBRES = { pedir: "pedir carta", plantarse: "plantarse", doblar: "doblar", separar: "separar" };

/** ¿La mano es blanda (un as cuenta como 11 sin pasarse)? */
function esBlanda(mano) {
    let total = mano.reduce((suma, c) => suma + c.value, 0);
    let ases = mano.filter((c) => c.value === 11).length;
    while (total > 21 && ases > 0) {
        total -= 10;
        ases--;
    }
    return ases > 0;
}

const entre = (v, desde, hasta) => v >= desde && v <= hasta;

/** Qué hacer con un par: "separar", "plantarse", "pedir" o null si hay que mirarlo como un total normal (el 5-5 y el 10-10). */
function paraPares(valor, crupier) {
    if (valor === 11 || valor === 8) return "separar";
    if (valor === 10) return "plantarse";
    if (valor === 9) return crupier === 7 || crupier >= 10 ? "plantarse" : "separar";
    if (valor === 7) return entre(crupier, 2, 7) ? "separar" : "pedir";
    if (valor === 6) return entre(crupier, 2, 6) ? "separar" : "pedir";
    if (valor === 4) return entre(crupier, 5, 6) ? "separar" : "pedir";
    if (valor === 2 || valor === 3) return entre(crupier, 2, 7) ? "separar" : "pedir";
    return null; // 5-5: se juega como un 10 duro
}

/** Qué hacer con un total blando (as contado como 11): "doblar" (si no se puede, pedir o plantarse), "pedir" o "plantarse". */
function paraBlandas(total, crupier) {
    if (total >= 19) return "plantarse";
    if (total === 18) {
        if (entre(crupier, 3, 6)) return "doblar-plantarse";
        return crupier === 2 || crupier === 7 || crupier === 8 ? "plantarse" : "pedir";
    }
    if (total === 17) return entre(crupier, 3, 6) ? "doblar" : "pedir";
    if (total >= 15) return entre(crupier, 4, 6) ? "doblar" : "pedir";
    return entre(crupier, 5, 6) ? "doblar" : "pedir"; // A-2 y A-3
}

/** Qué hacer con un total duro. */
function paraDuras(total, crupier) {
    if (total >= 17) return "plantarse";
    if (total >= 13) return entre(crupier, 2, 6) ? "plantarse" : "pedir";
    if (total === 12) return entre(crupier, 4, 6) ? "plantarse" : "pedir";
    if (total === 11) return crupier === 11 ? "pedir" : "doblar";
    if (total === 10) return entre(crupier, 2, 9) ? "doblar" : "pedir";
    if (total === 9) return entre(crupier, 3, 6) ? "doblar" : "pedir";
    return "pedir";
}

/**
 * La jugada que recomienda la estrategia básica para la mano del jugador en la partida `state`.
 * @returns {{ accion: "pedir"|"plantarse"|"doblar"|"separar", total: number, blanda: boolean, crupier: number }}
 */
function recomendarAccion(state) {
    const mano = state.userHand;
    const crupier = state.botHand[0].value;
    const total = handValue(mano);
    const blanda = esBlanda(mano);
    const dosCartas = mano.length === 2 && !state.split;
    let accion = null;
    if (dosCartas && mano[0].value === mano[1].value) accion = paraPares(mano[0].value, crupier);
    if (accion === "separar" && !state.puedeSplit) accion = mano[0].value === 11 ? "pedir" : paraDuras(total, crupier);
    if (!accion) accion = blanda && total <= 21 ? paraBlandas(total, crupier) : paraDuras(total, crupier);

    // Doblar solo con dos cartas y saldo para otra apuesta; si no, la jugada de al lado (en 18 blando, plantarse).
    const sePuedeDoblar = dosCartas && state.puedeDoblar;
    if (accion === "doblar-plantarse") accion = sePuedeDoblar ? "doblar" : "plantarse";
    if (accion === "doblar" && !sePuedeDoblar) accion = "pedir";
    return { accion, total, blanda, crupier };
}

/** El texto del consejo para el jugador. */
function textoConsejo(state) {
    const { accion, total, blanda, crupier } = recomendarAccion(state);
    const visible = crupier === 11 ? "un as" : `un ${crupier}`;
    return `💡 La estrategia básica dice: **${NOMBRES[accion]}**. Tienes ${blanda ? "una mano blanda de " : ""}${total} y el crupier enseña ${visible}.`;
}

module.exports = { esBlanda, recomendarAccion, textoConsejo };
