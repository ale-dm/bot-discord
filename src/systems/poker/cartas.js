// 🃏 Las cartas del póker (#531): la baraja francesa de 52 (con los palos y la forma de sacar carta del blackjack) y el
// evaluador de manos de Texas hold'em: el valor de 5 cartas, la mejor de 5 entre 7 y la comparación con desempates y
// kickers. Sin nada de Discord ni de dinero.
const { sacarCarta } = require("../blackjack");

const PALOS = ["♠️", "♥️", "♦️", "♣️"];
const FIGURAS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
/** Las categorías, de peor a mejor (el número es su fuerza). */
const CATEGORIAS = ["Carta alta", "Pareja", "Doble pareja", "Trío", "Escalera", "Color", "Full", "Póker", "Escalera de color"];

const texto = (rango, palo) => `${FIGURAS[rango] || rango}${palo}`;

/** Una baraja de 52 cartas: { rango (2 a 14, el as es 14), palo, texto }. */
function crearBaraja() {
    const baraja = [];
    for (const palo of PALOS) for (let rango = 2; rango <= 14; rango++) baraja.push({ rango, palo, texto: texto(rango, palo) });
    return baraja;
}

/** Saca una carta al azar (la quita de la baraja). */
const sacar = (baraja, rng = Math.random) => sacarCarta(baraja, rng);

/** La carta más alta de una escalera en estos rangos (distintos y ordenados de mayor a menor), o 0. La rueda A-2-3-4-5 vale 5. */
function escaleraAlta(rangos) {
    const r = [...new Set(rangos)].sort((a, b) => b - a);
    if (r.includes(14)) r.push(1);
    for (let i = 0; i + 4 < r.length; i++) {
        if (r[i] - r[i + 4] === 4) return r[i];
    }
    return 0;
}

/**
 * El valor de exactamente 5 cartas: [categoría, ...desempates], comparable de izquierda a derecha.
 * @param {{ rango: number, palo: string }[]} cartas
 */
function evaluar5(cartas) {
    const rangos = cartas.map((c) => c.rango).sort((a, b) => b - a);
    const color = cartas.every((c) => c.palo === cartas[0].palo);
    const alta = escaleraAlta(rangos);
    const cuenta = new Map();
    for (const r of rangos) cuenta.set(r, (cuenta.get(r) || 0) + 1);
    // Los grupos ordenados por tamaño y, a igualdad, por rango: [[rango, veces], …]
    const grupos = [...cuenta].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const porGrupos = grupos.map(([r]) => r);
    if (alta && color) return [8, alta];
    if (grupos[0][1] === 4) return [7, ...porGrupos];
    if (grupos[0][1] === 3 && grupos[1][1] === 2) return [6, ...porGrupos];
    if (color) return [5, ...rangos];
    if (alta) return [4, alta];
    if (grupos[0][1] === 3) return [3, ...porGrupos];
    if (grupos[0][1] === 2 && grupos[1][1] === 2) return [2, ...porGrupos];
    if (grupos[0][1] === 2) return [1, ...porGrupos];
    return [0, ...rangos];
}

/** Compara dos valores: positivo si gana `a`, negativo si gana `b`, 0 si empatan. */
function comparar(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

/** Las combinaciones de `k` elementos de una lista. */
function combinaciones(lista, k) {
    if (k === 0) return [[]];
    if (lista.length < k) return [];
    const [primero, ...resto] = lista;
    return [...combinaciones(resto, k - 1).map((c) => [primero, ...c]), ...combinaciones(resto, k)];
}

/** La mejor mano de 5 entre 5, 6 o 7 cartas: { valor, cartas, nombre }. */
function mejorMano(cartas) {
    let mejor = null;
    for (const cinco of combinaciones(cartas, 5)) {
        const valor = evaluar5(cinco);
        if (!mejor || comparar(valor, mejor.valor) > 0) mejor = { valor, cartas: cinco };
    }
    return { ...mejor, nombre: CATEGORIAS[mejor.valor[0]] };
}

module.exports = { PALOS, CATEGORIAS, crearBaraja, sacar, texto, escaleraAlta, evaluar5, comparar, combinaciones, mejorMano };
