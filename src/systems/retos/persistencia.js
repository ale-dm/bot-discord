// Lectura y escritura de la tabla de retos: cargar un reto con sus participantes, guardar su partida, y las consultas
// que usan los paneles (los retos de alguien y sus estadísticas).
const db = require("../../core/db");

/** Un reto con sus participantes, y `opciones` y `datos` ya leídos del JSON. null si no existe. */
function obtener(id) {
    const r = db
        .prepare(
            "SELECT id, tipo, estado, creador, rival, cantidad, guildId, channelId, messageId, match_id, eleccion, juego, pregunta, opciones, provocacion, datos, resultado, creado_en, actualizado_en, expira_en, resuelto_en, recordado_en, cierra_en, contraoferta, serie FROM retos WHERE id = ?",
        )
        .get(Number(id));
    if (!r) return null;
    return {
        ...r,
        opciones: r.opciones ? JSON.parse(r.opciones) : null,
        datos: r.datos ? JSON.parse(r.datos) : null,
        participantes: db
            .prepare(
                "SELECT reto_id, userId, opcion, cantidad, premio, unido_en FROM retos_participantes WHERE reto_id = ? ORDER BY unido_en, rowid",
            )
            .all(r.id),
    };
}

const partidoDe = (matchId) =>
    db
        .prepare(
            "SELECT id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea FROM apuestas_partidos WHERE match_id = ?",
        )
        .get(matchId);

/** Los próximos partidos abiertos (de cualquier competición), para elegir uno al retar. */
function partidosParaRetar(limite = 25) {
    return db
        .prepare(
            "SELECT id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea FROM apuestas_partidos WHERE estado = 'abierto' AND start_time > ? ORDER BY start_time LIMIT ?",
        )
        .all(new Date().toISOString(), limite);
}

/** El mensaje público donde está el reto, para poder editarlo cuando cambie. */
function guardarMensaje(retoId, channelId, messageId) {
    db.prepare("UPDATE retos SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, retoId);
}

function guardarDatos(retoId, datos) {
    db.prepare("UPDATE retos SET datos = ?, actualizado_en = ? WHERE id = ?").run(JSON.stringify(datos), Date.now(), retoId);
}

/** Los retos de alguien: los que le han lanzado, los que espera, los que están en juego y los últimos cerrados. */
function deUsuario(userId, limiteCerrados = 5) {
    const id = String(userId);
    const ids = (sql, ...params) =>
        db
            .prepare(sql)
            .all(...params)
            .map((r) => obtener(r.id));
    return {
        recibidos: ids("SELECT id FROM retos WHERE estado = 'pendiente' AND rival = ? ORDER BY creado_en DESC", id),
        enviados: ids("SELECT id FROM retos WHERE estado = 'pendiente' AND creador = ? ORDER BY creado_en DESC", id),
        enJuego: ids(
            `SELECT id FROM retos WHERE estado IN ('en_juego', 'abierta', 'cerrada')
               AND (creador = ? OR id IN (SELECT reto_id FROM retos_participantes WHERE userId = ?))
             ORDER BY actualizado_en DESC LIMIT 10`,
            id,
            id,
        ),
        cerrados: ids(
            `SELECT r.id FROM retos r JOIN retos_participantes p ON p.reto_id = r.id
             WHERE p.userId = ? AND r.estado IN ('resuelto', 'devuelto') ORDER BY r.resuelto_en DESC LIMIT ?`,
            id,
            limiteCerrados,
        ),
    };
}

/** Ganados, perdidos, devueltos, beneficio y lo que hay en juego de alguien en retos. */
function estadisticas(userId) {
    const r = db
        .prepare(
            `SELECT COUNT(CASE WHEN r.estado = 'resuelto' AND p.premio > 0 THEN 1 END) AS ganados,
                    COUNT(CASE WHEN r.estado = 'resuelto' AND p.premio = 0 THEN 1 END) AS perdidos,
                    COUNT(CASE WHEN r.estado = 'devuelto' THEN 1 END)                  AS devueltos,
                    COALESCE(SUM(CASE WHEN r.estado IN ('resuelto', 'devuelto') THEN p.premio - p.cantidad END), 0) AS beneficio,
                    COALESCE(SUM(CASE WHEN r.estado NOT IN ('resuelto', 'devuelto') THEN p.cantidad END), 0) AS enJuego
             FROM retos_participantes p JOIN retos r ON r.id = p.reto_id
             WHERE p.userId = ?`,
        )
        .get(String(userId));
    return { ganados: r.ganados, perdidos: r.perdidos, devueltos: r.devueltos, beneficio: r.beneficio, enJuego: r.enJuego };
}

/**
 * El cara a cara entre dos personas (#437): los duelos y retos a un partido que han resuelto entre ellas. Cuenta las
 * victorias de cada una (por el premio cobrado), el beneficio neto de `a` contra `b` y los últimos `limite` retos. Los
 * devueltos no cuentan, ni las porras (en una porra no se juegan una contra otra). Solo personas: el Duende no entra.
 * @returns {{ victoriasA: number, victoriasB: number, netoA: number, total: number, ultimos: object[] }}
 */
function caraACara(a, b, limite = 5) {
    if (String(a) === String(b)) return { victoriasA: 0, victoriasB: 0, netoA: 0, total: 0, ultimos: [] };
    const filas = db
        .prepare(
            `SELECT r.id, pa.premio AS premioA, pa.cantidad AS cantidadA, pb.premio AS premioB
             FROM retos r
             JOIN retos_participantes pa ON pa.reto_id = r.id AND pa.userId = ?
             JOIN retos_participantes pb ON pb.reto_id = r.id AND pb.userId = ?
             WHERE r.estado = 'resuelto' AND r.tipo IN ('duelo', 'partido')
             ORDER BY r.resuelto_en DESC, r.id DESC`,
        )
        .all(String(a), String(b));
    return {
        victoriasA: filas.filter((f) => f.premioA > 0).length,
        victoriasB: filas.filter((f) => f.premioB > 0).length,
        netoA: filas.reduce((s, f) => s + f.premioA - f.cantidadA, 0),
        total: filas.length,
        ultimos: filas.slice(0, limite).map((f) => obtener(f.id)),
    };
}

module.exports = { obtener, caraACara, partidoDe, partidosParaRetar, guardarMensaje, guardarDatos, deUsuario, estadisticas };
