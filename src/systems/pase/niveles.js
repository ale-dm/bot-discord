// La curva de niveles del pase: lo que cuesta cada nivel (XP_NIVEL_BASE más XP_NIVEL_PASO por nivel) y el nivel de un total de XP. Sin base de
// datos: `curva` ({ xpBase, xpPaso }, de systems/pase/ajustes) es opcional y, sin ella, vale la de siempre.
const { NIVEL_MAX, XP_NIVEL_BASE, XP_NIVEL_PASO } = require("./constantes");

const CURVA_POR_DEFECTO = { xpBase: XP_NIVEL_BASE, xpPaso: XP_NIVEL_PASO };

/** Lo que cuesta pasar del nivel n al siguiente. */
const xpDelNivel = (n, curva = CURVA_POR_DEFECTO) => curva.xpBase + (n - 1) * curva.xpPaso;

/** XP acumulada necesaria para llegar al nivel n (el nivel 1 cuesta 0). */
function xpParaNivel(n, curva = CURVA_POR_DEFECTO) {
    let total = 0;
    for (let k = 1; k < n; k++) total += xpDelNivel(k, curva);
    return total;
}

/** Nivel de un total de XP de pase: 1 a NIVEL_MAX. */
function nivelDe(xp, curva = CURVA_POR_DEFECTO) {
    let nivel = 1;
    while (nivel < NIVEL_MAX && xp >= xpParaNivel(nivel + 1, curva)) nivel++;
    return nivel;
}

module.exports = { xpDelNivel, xpParaNivel, nivelDe };
