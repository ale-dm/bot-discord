// Una fila de Discord admite 5 botones: los que no caben se reparten en filas nuevas, en orden.
const MAX_FILA = 5;

/** Trozos de como mucho `n` elementos, en orden: [[1..5], [6..7]] para 7 botones. */
function trozos(lista, n = MAX_FILA) {
    const grupos = [];
    for (let i = 0; i < lista.length; i += n) grupos.push(lista.slice(i, i + n));
    return grupos;
}

module.exports = { MAX_FILA, trozos };
