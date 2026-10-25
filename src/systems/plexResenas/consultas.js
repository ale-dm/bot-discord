// 🍿 Consultas públicas de reseñas: media, votos, histograma, mejores, últimas y quién más valora. Fuera lo oculto.
const db = require("../../core/db");
const { normalizar } = require("../plexFichas");
const { normalizarFila } = require("./guardar");

const JOIN_PREF = "LEFT JOIN plex_preferencias p ON p.guildId = r.guildId AND p.userId = r.userId";
const PUBLICAS = "r.oculto = 0 AND COALESCE(p.ocultar_resenas, 0) = 0";

/** Media (0–5), votos e histograma de 1 a 10 medias estrellas de un título. */
function resumen(guildId, clave) {
    const filas = db
        .prepare(`SELECT r.nota FROM plex_resenas r ${JOIN_PREF} WHERE r.guildId = ? AND r.clave = ? AND ${PUBLICAS}`)
        .all(guildId, clave);
    const histograma = Array.from({ length: 10 }, (_, i) => ({ nota: i + 1, votos: 0 }));
    let suma = 0;
    for (const f of filas) {
        suma += f.nota;
        histograma[f.nota - 1].votos++;
    }
    return {
        media: filas.length ? Math.round((suma / filas.length / 2) * 10) / 10 : null,
        votos: filas.length,
        histograma,
    };
}

/** La ficha de un título: resumen y sus reseñas públicas, de la más reciente a la más antigua. */
function titulo(guildId, clave, { limite = 20 } = {}) {
    const resenas = db
        .prepare(
            `SELECT r.* FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND r.clave = ? AND ${PUBLICAS}
             ORDER BY r.actualizado_en DESC LIMIT ?`,
        )
        .all(guildId, clave, limite)
        .map(normalizarFila);
    return { clave, ...resumen(guildId, clave), resenas };
}

/** Las reseñas de una persona, también las suyas ocultas (son suyas). */
function deUsuario(guildId, userId, { limite = 50 } = {}) {
    return db
        .prepare("SELECT * FROM plex_resenas WHERE guildId = ? AND userId = ? ORDER BY actualizado_en DESC LIMIT ?")
        .all(guildId, String(userId), limite)
        .map(normalizarFila);
}

/** Las mejor valoradas, con un mínimo de votos para que una sola persona no coloque su favorita arriba. */
function mejores(guildId, { minVotos = 3, limite = 10 } = {}) {
    return db
        .prepare(
            `SELECT r.clave, MAX(r.titulo) AS titulo, MAX(r.tipo) AS tipo, MAX(r.anio) AS anio,
                    ROUND(AVG(r.nota) / 2, 1) AS media, COUNT(*) AS votos
             FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND ${PUBLICAS}
             GROUP BY r.clave HAVING COUNT(*) >= ?
             ORDER BY media DESC, votos DESC, titulo COLLATE NOCASE LIMIT ?`,
        )
        .all(guildId, Math.max(1, Number(minVotos) || 1), limite);
}

/** Las últimas reseñas públicas del servidor. */
function ultimas(guildId, { limite = 10 } = {}) {
    return db
        .prepare(
            `SELECT r.* FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND ${PUBLICAS}
             ORDER BY r.actualizado_en DESC LIMIT ?`,
        )
        .all(guildId, limite)
        .map(normalizarFila);
}

/** Quién más reseñas escribe (sin contar a quien las oculta). */
function rankingValoradores(guildId, { limite = 5 } = {}) {
    return db
        .prepare(
            `SELECT r.userId, COUNT(*) AS n FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND ${PUBLICAS}
             GROUP BY r.userId ORDER BY n DESC, r.userId ASC LIMIT ?`,
        )
        .all(guildId, limite);
}

/** Las reseñas públicas de una persona, de la más reciente a la más antigua. Las que oculta no salen (ni para el Duende). */
function publicasDe(guildId, userId, { limite = 5 } = {}) {
    return db
        .prepare(
            `SELECT r.* FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND r.userId = ? AND ${PUBLICAS}
             ORDER BY r.actualizado_en DESC LIMIT ?`,
        )
        .all(guildId, String(userId), limite)
        .map(normalizarFila);
}

/** Los títulos con reseñas públicas que se llaman como `titulo` (sin mayúsculas ni tildes), con su año. */
function titulosLlamados(guildId, texto) {
    const buscado = normalizar(texto);
    return db
        .prepare(`SELECT DISTINCT r.clave, r.titulo, r.anio FROM plex_resenas r ${JOIN_PREF} WHERE r.guildId = ? AND ${PUBLICAS}`)
        .all(guildId)
        .filter((f) => normalizar(f.titulo) === buscado);
}

/** Quién da la media más alta (`orden` DESC, 😇 generoso) o la más baja (ASC, 😈 crítico), con un mínimo de reseñas. */
function generosidad(guildId, { orden = "DESC", minVotos = 3, limite = 5 } = {}) {
    const sentido = orden === "ASC" ? "ASC" : "DESC";
    return db
        .prepare(
            `SELECT r.userId, ROUND(AVG(r.nota) / 2, 1) AS media, COUNT(*) AS n
             FROM plex_resenas r ${JOIN_PREF}
             WHERE r.guildId = ? AND ${PUBLICAS}
             GROUP BY r.userId HAVING COUNT(*) >= ?
             ORDER BY media ${sentido}, n DESC, r.userId ASC LIMIT ?`,
        )
        .all(guildId, Math.max(1, Number(minVotos) || 1), limite);
}

/** La media (0–5) y los votos de todas las reseñas públicas del servidor: lo oculto de cada uno no cuenta (📊 Mi cine). */
function mediaPublica(guildId) {
    const r = db
        .prepare(`SELECT AVG(r.nota) AS nota, COUNT(*) AS votos FROM plex_resenas r ${JOIN_PREF} WHERE r.guildId = ? AND ${PUBLICAS}`)
        .get(guildId);
    return { media: r.votos ? Math.round((r.nota / 2) * 10) / 10 : null, votos: r.votos };
}

/**
 * Las reseñas de un título con ese nombre, también las ocultas: para moderar (el panel admin). `anio` filtra si se da.
 * @returns {Array<object>} filas normalizadas (con `oculto`)
 */
function todasDelTitulo(guildId, texto, anio = null) {
    const buscado = normalizar(texto);
    return db
        .prepare("SELECT * FROM plex_resenas WHERE guildId = ?")
        .all(guildId)
        .map(normalizarFila)
        .filter((r) => normalizar(r.titulo) === buscado && (!anio || r.anio === Number(anio)));
}

/**
 * Los números del panel admin de reseñas, sobre todas las reseñas del servidor (también las ocultas) y los avisos
 * que esperan respuesta. Son los mismos que sale al contar en la BD.
 */
function resumenAdmin(guildId) {
    const total = db
        .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(oculto), 0) AS ocultas, AVG(nota) AS nota FROM plex_resenas WHERE guildId = ?")
        .get(guildId);
    const pendientes = db.prepare("SELECT COUNT(*) AS n FROM plex_resenas_pedidas WHERE guildId = ? AND decision IS NULL").get(guildId).n;
    return {
        total: total.total,
        ocultas: total.ocultas,
        media: total.nota === null ? null : Math.round((total.nota / 2) * 10) / 10,
        pendientes,
    };
}

module.exports = {
    resumen,
    titulo,
    deUsuario,
    publicasDe,
    titulosLlamados,
    mejores,
    ultimas,
    rankingValoradores,
    generosidad,
    mediaPublica,
    todasDelTitulo,
    resumenAdmin,
};
