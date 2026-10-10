// Índice para la clave foránea tienda.objetoId: la usan el catálogo del panel admin (LEFT JOIN de objeto a tienda, y
// comprobar si un objeto está a la venta) y los borrados, y sin él cada búsqueda recorre la tabla entera. Es IF NOT
// EXISTS, y si una BD antigua no tiene la columna, el índice se omite (ver indices.js).
const { crearIndices } = require("./indices");

const INDICES = ["CREATE INDEX IF NOT EXISTS idx_tienda_objetoId ON tienda(objetoId)"];

function up(db) {
    crearIndices(db, INDICES);
}

module.exports = { up, INDICES };
