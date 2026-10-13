// SQL de las apuestas deportivas y las quinielas que usan los botones de la quiniela y el panel de admin → ⚽ Apuestas. Las
// reglas están en systems/apuestas; aquí solo las consultas, tal cual (#473).
const db = require("../core/db");

const COLUMNAS_QUINIELA = "id, deporte, jornada, estado, creador_id, creada_en, cerrada_en";

/** Una quiniela abierta por su id, o undefined. */
const quinielaAbierta = (id) => db.prepare(`SELECT ${COLUMNAS_QUINIELA} FROM quinielas WHERE id = ? AND estado = 'abierta'`).get(id);

/** La última quiniela abierta de una competición, o undefined. */
const ultimaQuinielaAbierta = (deporte) =>
    db
        .prepare(
            `
            SELECT ${COLUMNAS_QUINIELA} FROM quinielas
            WHERE estado = 'abierta' AND deporte = ?
            ORDER BY id DESC
            LIMIT 1
        `,
        )
        .get(deporte);

const yaApostoQuiniela = (quinielaId, userId) =>
    Boolean(db.prepare(`SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?`).get(quinielaId, userId));

const boteQuiniela = (quinielaId) =>
    db.prepare(`SELECT COALESCE(SUM(cantidad), 0) AS total FROM quiniela_apuestas WHERE quiniela_id = ?`).get(quinielaId)?.total || 0;

const pendientesPorDeporte = () =>
    db
        .prepare(
            `SELECT p.deporte, COUNT(DISTINCT p.match_id) AS partidos, COUNT(*) AS apuestas, COALESCE(SUM(a.cantidad), 0) AS importe
             FROM apuestas_usuario a JOIN apuestas_partidos p ON a.match_id = p.match_id
             WHERE a.pagado = 0 GROUP BY p.deporte`,
        )
        .all();

const quinielasAbiertas = () =>
    db
        .prepare(
            `SELECT q.deporte, q.jornada, COUNT(qa.id) AS jugadores, COALESCE(SUM(qa.cantidad), 0) AS bote
             FROM quinielas q LEFT JOIN quiniela_apuestas qa ON qa.quiniela_id = q.id
             WHERE q.estado = 'abierta' GROUP BY q.id`,
        )
        .all();

const partidosCaducadosDesde = (iso) =>
    db.prepare("SELECT COUNT(*) AS n FROM apuestas_partidos WHERE estado = 'caducado' AND start_time >= ?").get(iso).n;

module.exports = {
    quinielaAbierta,
    ultimaQuinielaAbierta,
    yaApostoQuiniela,
    boteQuiniela,
    pendientesPorDeporte,
    quinielasAbiertas,
    partidosCaducadosDesde,
};
