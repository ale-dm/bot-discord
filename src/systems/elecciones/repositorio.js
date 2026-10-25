// 🗳️ El SQL de las elecciones: la elección, sus candidatos y sus votos. Lo del presidente durante el mandato (canales,
// sanciones y acciones) está en repositorioPresidencia.js. Sin reglas: las validaciones están en el resto de systems/elecciones.
const db = require("../../core/db");

const TERMINADAS = "('cerrada', 'cancelada')";

const leerEleccion = (f) => f || null;
const leerCandidato = (f) => (f ? { ...f, finalista: Boolean(f.finalista), retirado: Boolean(f.retirado) } : null);

const obtener = (id) => leerEleccion(db.prepare("SELECT * FROM elecciones WHERE id = ?").get(Number(id)));

/** La elección en marcha del servidor (cualquier fase salvo cerrada o cancelada), o null. Solo hay una a la vez. */
const activa = (guildId) =>
    leerEleccion(
        db
            .prepare(`SELECT * FROM elecciones WHERE guildId = ? AND estado NOT IN ${TERMINADAS} ORDER BY id DESC LIMIT 1`)
            .get(String(guildId)),
    );

/** La última elección del servidor que acabó con presidente (para no dejar repetir si la reelección está apagada). */
const ultimaConPresidente = (guildId) =>
    leerEleccion(
        db.prepare("SELECT * FROM elecciones WHERE guildId = ? AND presidenteId IS NOT NULL ORDER BY id DESC LIMIT 1").get(String(guildId)),
    );

function crear({ guildId, creadaPor, channelId = null, ahora, fin }) {
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO elecciones (guildId, estado, creada_por, creada_en, fase_inicio, fase_fin, channelId)
             VALUES (?, 'inscripcion', ?, ?, ?, ?, ?)`,
        )
        .run(String(guildId), String(creadaPor), ahora, ahora, fin, channelId);
    return obtener(lastInsertRowid);
}

function guardarMensaje(id, channelId, messageId) {
    db.prepare("UPDATE elecciones SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, Number(id));
}

/**
 * Pasa de fase solo si sigue en `de` (dos pasadas del cron a la vez no la avanzan dos veces).
 * @returns {boolean} si ha cambiado
 */
function cambiarFase(id, de, a, { ahora, fin, presidenteId, motivo } = {}) {
    const terminada = a === "cerrada" || a === "cancelada";
    const { changes } = db
        .prepare(
            `UPDATE elecciones SET estado = ?, fase_inicio = ?, fase_fin = ?, presidenteId = COALESCE(?, presidenteId),
                    cerrada_en = ?, motivo_cierre = COALESCE(?, motivo_cierre)
             WHERE id = ? AND estado = ?`,
        )
        .run(a, ahora, fin ?? ahora, presidenteId ?? null, terminada ? ahora : null, motivo ?? null, Number(id), de);
    return changes === 1;
}

/** Adelanta el final de la fase actual (para que el cron la cierre ya). */
function adelantarFin(id, ahora) {
    db.prepare(`UPDATE elecciones SET fase_fin = ? WHERE id = ? AND estado NOT IN ${TERMINADAS}`).run(ahora, Number(id));
}

/** Las elecciones en marcha cuya fase ya ha acabado (de todos los servidores). */
const vencidas = (ahora) =>
    db.prepare(`SELECT * FROM elecciones WHERE estado NOT IN ${TERMINADAS} AND fase_fin <= ? ORDER BY fase_fin, id`).all(ahora);

// —— Candidatos ——

const candidato = (eleccionId, userId) =>
    leerCandidato(
        db.prepare("SELECT * FROM elecciones_candidatos WHERE eleccion_id = ? AND userId = ?").get(Number(eleccionId), String(userId)),
    );

/** Los candidatos que siguen (sin los retirados), por orden de inscripción. Con `finalistas`, solo los finalistas. */
const candidatos = (eleccionId, { finalistas = false } = {}) =>
    db
        .prepare(
            `SELECT * FROM elecciones_candidatos WHERE eleccion_id = ? AND retirado = 0 ${finalistas ? "AND finalista = 1" : ""}
             ORDER BY inscrito_en, userId`,
        )
        .all(Number(eleccionId))
        .map(leerCandidato);

/** Inscribe (o vuelve a inscribir a quien se había retirado). */
function inscribir(eleccionId, userId, ahora) {
    db.prepare(
        `INSERT INTO elecciones_candidatos (eleccion_id, userId, inscrito_en) VALUES (?, ?, ?)
         ON CONFLICT(eleccion_id, userId) DO UPDATE SET retirado = 0, inscrito_en = excluded.inscrito_en`,
    ).run(Number(eleccionId), String(userId), ahora);
}

function retirar(eleccionId, userId) {
    db.prepare("UPDATE elecciones_candidatos SET retirado = 1 WHERE eleccion_id = ? AND userId = ?").run(
        Number(eleccionId),
        String(userId),
    );
}

function marcarFinalistas(eleccionId, userIds) {
    const marcar = db.prepare("UPDATE elecciones_candidatos SET finalista = 1 WHERE eleccion_id = ? AND userId = ?");
    for (const userId of userIds) marcar.run(Number(eleccionId), String(userId));
}

function guardarPrograma(eleccionId, userId, titulo, texto, ahora) {
    db.prepare(
        "UPDATE elecciones_candidatos SET programa_titulo = ?, programa_texto = ?, programa_en = ? WHERE eleccion_id = ? AND userId = ?",
    ).run(titulo, texto, ahora, Number(eleccionId), String(userId));
}

// —— Votos ——

const votoDe = (eleccionId, fase, votanteId) =>
    db
        .prepare("SELECT * FROM elecciones_votos WHERE eleccion_id = ? AND fase = ? AND votanteId = ?")
        .get(Number(eleccionId), fase, String(votanteId)) || null;

/** Un voto por persona y fase: votar otra vez lo reemplaza (candidato y si es público). */
function guardarVoto({ eleccionId, fase, votanteId, candidatoId, publico, ahora }) {
    db.prepare(
        `INSERT INTO elecciones_votos (eleccion_id, fase, votanteId, candidatoId, publico, votado_en) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(eleccion_id, fase, votanteId) DO UPDATE SET
             candidatoId = excluded.candidatoId, publico = excluded.publico, votado_en = excluded.votado_en`,
    ).run(Number(eleccionId), fase, String(votanteId), String(candidatoId), publico ? 1 : 0, ahora);
}

/** Votos por candidato en una fase (solo los que van a candidatos que siguen). */
const conteos = (eleccionId, fase) =>
    db
        .prepare(
            `SELECT v.candidatoId AS userId, COUNT(*) AS votos FROM elecciones_votos v
             JOIN elecciones_candidatos c ON c.eleccion_id = v.eleccion_id AND c.userId = v.candidatoId AND c.retirado = 0
             WHERE v.eleccion_id = ? AND v.fase = ? GROUP BY v.candidatoId`,
        )
        .all(Number(eleccionId), fase);

/** Los votos públicos de una fase, el más reciente primero. */
const votosPublicos = (eleccionId, fase, limite = 10) =>
    db
        .prepare(
            `SELECT votanteId, candidatoId, votado_en FROM elecciones_votos
             WHERE eleccion_id = ? AND fase = ? AND publico = 1 ORDER BY votado_en DESC, votanteId LIMIT ?`,
        )
        .all(Number(eleccionId), fase, limite);

const totalVotos = (eleccionId, fase) =>
    db.prepare("SELECT COUNT(*) FROM elecciones_votos WHERE eleccion_id = ? AND fase = ?").pluck().get(Number(eleccionId), fase);

const totalPublicos = (eleccionId, fase) =>
    db
        .prepare("SELECT COUNT(*) FROM elecciones_votos WHERE eleccion_id = ? AND fase = ? AND publico = 1")
        .pluck()
        .get(Number(eleccionId), fase);

module.exports = {
    obtener,
    activa,
    ultimaConPresidente,
    crear,
    guardarMensaje,
    cambiarFase,
    adelantarFin,
    vencidas,
    candidato,
    candidatos,
    inscribir,
    retirar,
    marcarFinalistas,
    guardarPrograma,
    votoDe,
    guardarVoto,
    conteos,
    votosPublicos,
    totalVotos,
    totalPublicos,
};
