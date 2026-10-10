// Reglas de las quinielas (DT-16): crear la jornada, cuándo se cierra, los partidos de cada una y cobrar la apuesta.
// Sin Discord: lo que se muestra al usuario lo decide src/juegos/apuestas/quiniela.js.
const db = require("../../core/db");
const dinero = require("../dinero");
const { logInfo, logError } = require("../../core/logger");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");

const QUINIELA_MATCH_COUNT = 10;
const QUINIELA_LOCK_MINUTES = Number(process.env.QUINIELA_LOCK_MINUTES || 15);

function obtenerSemanaISO(fecha) {
    const date = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return { year: date.getUTCFullYear(), week };
}

function construirNombreJornadaSemanal(deporteSeleccionado, partidos) {
    const ahora = new Date();
    const { week } = obtenerSemanaISO(ahora);
    return `Jornada ${week}`;
}

function obtenerPartidosQuiniela(quinielaId) {
    return db
        .prepare(
            `
        SELECT id, quiniela_id, match_id, orden, home_team, away_team, start_time, resultado_final FROM quiniela_partidos
        WHERE quiniela_id = ?
        ORDER BY orden ASC
    `,
        )
        .all(quinielaId);
}

// La quiniela se cierra QUINIELA_LOCK_MINUTES antes del primer partido (y de cada partido, al elegirlo).
function estaBloqueadoPorTiempo(startTime) {
    const inicio = new Date(startTime).getTime();
    const ahora = Date.now();
    const diffMs = inicio - ahora;
    return diffMs <= QUINIELA_LOCK_MINUTES * 60 * 1000;
}

function yaApostoQuiniela(quinielaId, userId) {
    return !!db.prepare(`SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?`).get(quinielaId, userId);
}

/**
 * Cobra y registra la apuesta, todo o nada. Devuelve false si no hay efectivo suficiente.
 * @param {string} pronosticos - una letra por partido (1, X o 2)
 */
function apostarQuiniela({ userId, quinielaId, pronosticos, cantidad }) {
    const tx = db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, cantidad)) throw new Error("Sin efectivo");
        db.prepare(
            `
                INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en)
                VALUES (?, ?, ?, ?, ?)
            `,
        ).run(quinielaId, userId, pronosticos, cantidad, new Date().toISOString());
        dinero.apuntar(userId, "apuestas", "Quiniela: apuesta", -cantidad);
    });
    try {
        tx();
        return true;
    } catch {
        return false;
    }
}

/**
 * 🛠️ Crear quiniela de la quiniela y el panel de admin → ⚽ Apuestas. @returns {{ ok: boolean, mensaje: string }}
 */
async function crearQuiniela(deporteSeleccionado, creadorId) {
    if (!DEPORTES[deporteSeleccionado]) return { ok: false, mensaje: "❌ Competición no válida." };
    const abierta = db.prepare(`SELECT id FROM quinielas WHERE estado = 'abierta' AND deporte = ? LIMIT 1`).get(deporteSeleccionado);
    if (abierta) return { ok: false, mensaje: "⚠️ Ya existe una quiniela activa para esta competición." };

    try {
        await sincronizarPartidos(deporteSeleccionado);
    } catch (e) {
        logError(`[Quiniela] No se pudieron sincronizar partidos de ${deporteSeleccionado}:`, e);
        return { ok: false, mensaje: `❌ No se pudo actualizar partidos: ${e.message}` };
    }

    const ahora = new Date().toISOString();
    const partidos = db
        .prepare(
            `SELECT id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea FROM apuestas_partidos WHERE deporte = ? AND estado = 'abierto' AND start_time > ? ORDER BY start_time ASC LIMIT ?`,
        )
        .all(deporteSeleccionado, ahora, QUINIELA_MATCH_COUNT);
    if (partidos.length < 5) return { ok: false, mensaje: "❌ No hay suficientes partidos próximos para crear quiniela (mínimo 5)." };

    const jornada = construirNombreJornadaSemanal(deporteSeleccionado, partidos);
    const mismaSemana = db
        .prepare(`SELECT id FROM quinielas WHERE deporte = ? AND jornada = ? ORDER BY id DESC LIMIT 1`)
        .get(deporteSeleccionado, jornada);
    if (mismaSemana) return { ok: false, mensaje: `⚠️ Ya existe una quiniela para ${jornada}.` };

    const quinielaId = db.transaction(() => {
        const res = db
            .prepare(`INSERT INTO quinielas (deporte, jornada, estado, creador_id, creada_en) VALUES (?, ?, 'abierta', ?, ?)`)
            .run(deporteSeleccionado, jornada, creadorId, ahora);
        const insertPartido = db.prepare(
            `INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        partidos.forEach((p, idx) => insertPartido.run(res.lastInsertRowid, p.match_id, idx + 1, p.home_team, p.away_team, p.start_time));
        return res.lastInsertRowid;
    })();
    logInfo(`[QUINIELA] Creada quiniela ${quinielaId} (${jornada}, ${deporteSeleccionado}) por ${creadorId}`);
    return {
        ok: true,
        mensaje: `✅ Quiniela **${jornada}** creada (${DEPORTES[deporteSeleccionado].name}) con ${partidos.length} partidos.`,
    };
}

module.exports = {
    QUINIELA_LOCK_MINUTES,
    obtenerPartidosQuiniela,
    estaBloqueadoPorTiempo,
    yaApostoQuiniela,
    apostarQuiniela,
    crearQuiniela,
};
