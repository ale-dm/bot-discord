// Lectura y escritura de la tabla de retos: cargar un reto con sus participantes, guardar su partida, y las consultas
// que usan los paneles (los retos de alguien y sus estadísticas).
const db = require("../../core/db");

/** Un reto con sus participantes, y `opciones` y `datos` ya leídos del JSON. null si no existe. */
function obtener(id) {
    const r = db.prepare("SELECT * FROM retos WHERE id = ?").get(Number(id));
    if (!r) return null;
    return {
        ...r,
        opciones: r.opciones ? JSON.parse(r.opciones) : null,
        datos: r.datos ? JSON.parse(r.datos) : null,
        participantes: db.prepare("SELECT * FROM retos_participantes WHERE reto_id = ? ORDER BY unido_en, rowid").all(r.id),
    };
}

const partidoDe = (matchId) => db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(matchId);

/** Los próximos partidos abiertos (de cualquier competición), para elegir uno al retar. */
function partidosParaRetar(limite = 25) {
    return db
        .prepare("SELECT * FROM apuestas_partidos WHERE estado = 'abierto' AND start_time > ? ORDER BY start_time LIMIT ?")
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

module.exports = { obtener, partidoDe, partidosParaRetar, guardarMensaje, guardarDatos, deUsuario, estadisticas };
