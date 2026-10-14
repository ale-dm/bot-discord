// 🗳️ Votar la película de una sesión de cine (#393): quien convoca propone hasta 5 películas (separadas por «|») y los apuntados
// votan con botones. Cada persona puede votar cada opción una vez (volver a pulsar quita el voto) y cambiar de opinión. Gana la que
// más votos tiene; en empate, la que se propuso antes. La votación se cierra al enviarse el recordatorio, que nombra la ganadora.
// Sin votos, la sesión sigue siendo la película del organizador (la primera opción), como una sesión de una sola película.
const db = require("../../core/db");

const MAX_OPCIONES = 5;
const TITULO_MAX = 100;

/** Las películas propuestas en un texto («Dune | Alien | Heat»): sin repetidas ni vacías, hasta MAX_OPCIONES. */
function parsearOpciones(texto) {
    const vistas = new Set();
    const lista = [];
    for (const parte of String(texto ?? "").split("|")) {
        const titulo = parte.trim().slice(0, TITULO_MAX);
        if (!titulo || vistas.has(titulo.toLowerCase())) continue;
        vistas.add(titulo.toLowerCase());
        lista.push(titulo);
    }
    return lista.slice(0, MAX_OPCIONES);
}

/** Guarda las opciones de una sesión (solo si hay más de una: con una sola no hay votación). */
function guardarOpciones(sesionId, lista) {
    if (lista.length < 2) return;
    const ins = db.prepare("INSERT INTO cine_opciones (sesion_id, idx, titulo) VALUES (?, ?, ?)");
    lista.forEach((titulo, idx) => ins.run(Number(sesionId), idx, titulo));
}

/** Las opciones de una sesión con sus votos: [{ idx, titulo, votos }] (vacío si la sesión no tiene votación). */
function opciones(sesionId) {
    return db
        .prepare(
            `SELECT o.idx, o.titulo, COUNT(v.userId) AS votos FROM cine_opciones o
             LEFT JOIN cine_votos v ON v.sesion_id = o.sesion_id AND v.idx = o.idx
             WHERE o.sesion_id = ? GROUP BY o.idx ORDER BY o.idx`,
        )
        .all(Number(sesionId));
}

/** Vota (o quita el voto) de una opción. Quien no esté apuntado no vota. @returns {{ ok: boolean, mensaje?: string, votando?: boolean }} */
function votar(sesionId, idx, userId) {
    const sesion = db.prepare("SELECT cancelada, recordatorio FROM cine_sesiones WHERE id = ?").get(Number(sesionId));
    if (!sesion || sesion.cancelada) return { ok: false, mensaje: "Esa sesión no está activa." };
    if (sesion.recordatorio) return { ok: false, mensaje: "La votación ya se cerró." };
    if (!db.prepare("SELECT 1 FROM cine_opciones WHERE sesion_id = ? AND idx = ?").get(Number(sesionId), Number(idx))) {
        return { ok: false, mensaje: "Esa opción no existe." };
    }
    if (!db.prepare("SELECT 1 FROM cine_asistentes WHERE sesion_id = ? AND userId = ?").get(Number(sesionId), String(userId))) {
        return { ok: false, mensaje: "Apúntate a la sesión para votar." };
    }
    const quita = db
        .prepare("DELETE FROM cine_votos WHERE sesion_id = ? AND idx = ? AND userId = ?")
        .run(Number(sesionId), Number(idx), String(userId));
    if (quita.changes) return { ok: true, votando: false };
    db.prepare("INSERT INTO cine_votos (sesion_id, idx, userId) VALUES (?, ?, ?)").run(Number(sesionId), Number(idx), String(userId));
    return { ok: true, votando: true };
}

/** La película ganadora: la más votada (en empate, la primera propuesta), o null si no hay votación o nadie ha votado. */
function ganadora(sesionId) {
    const lista = opciones(sesionId);
    const mejor = lista.reduce((a, o) => (o.votos > (a?.votos ?? 0) ? o : a), null);
    return mejor && mejor.votos > 0 ? mejor : null;
}

module.exports = { MAX_OPCIONES, parsearOpciones, guardarOpciones, opciones, votar, ganadora };
