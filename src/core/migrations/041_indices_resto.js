// Índices que faltaban en consultas de tablas pequeñas o diarias, que sí recorrían la tabla entera: el listado de
// quinielas abiertas, el ranking y la liga (quinielas cerradas por fecha), las rachas diarias de XP y los ingresos de
// los negocios. Son IF NOT EXISTS, y si una BD antigua no tiene la columna, el índice se omite (ver indices.js).
const { crearIndices } = require("./indices");

const INDICES = [
    "CREATE INDEX IF NOT EXISTS idx_quinielas_estado_deporte ON quinielas(estado, deporte)",
    "CREATE INDEX IF NOT EXISTS idx_quinielas_estado_cerrada ON quinielas(estado, cerrada_en)",
    "CREATE INDEX IF NOT EXISTS idx_xp_users_racha ON xp_users(streak_last_day)",
    "CREATE INDEX IF NOT EXISTS idx_negocios_usuario_ingreso ON negocios_usuario(ultimo_ingreso_dia)",
];

function up(db) {
    crearIndices(db, INDICES);
}

module.exports = { up, INDICES };
