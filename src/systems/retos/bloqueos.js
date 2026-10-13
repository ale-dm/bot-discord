// Bloqueos de retos (#450): quien bloquea a alguien deja de recibir retos suyos (duelos, partidos y los abiertos que esa
// persona haya lanzado y él quisiera aceptar), y los retos pendientes entre las dos personas se devuelven. Es en un solo
// sentido: bloquear a alguien no impide retarle. Los retos que ya están en juego no se tocan.
const db = require("../../core/db");
const { error } = require("./comun");
const { obtener } = require("./persistencia");
const { devolver } = require("./cobros");

/** ¿Tiene `bloqueador` bloqueado a `bloqueado`? */
function bloqueado(bloqueador, bloqueado_) {
    return Boolean(
        db.prepare("SELECT 1 FROM retos_bloqueos WHERE bloqueador = ? AND bloqueado = ?").get(String(bloqueador), String(bloqueado_)),
    );
}

/** Las personas que `userId` tiene bloqueadas, de la más antigua a la más reciente. */
function listarBloqueos(userId) {
    return db.prepare("SELECT bloqueado FROM retos_bloqueos WHERE bloqueador = ? ORDER BY creado_en, rowid").pluck().all(String(userId));
}

/**
 * `bloqueador` bloquea a `otro`: guarda el bloqueo y devuelve los retos pendientes entre las dos personas, en los dos sentidos.
 * @returns {{ ok: true, devueltos: object[], pagos: object[] } | { ok: false, mensaje: string }}
 */
function bloquear(bloqueador, otro) {
    const a = String(bloqueador);
    const b = String(otro);
    if (a === b) return error("❌ No puedes bloquearte a ti mismo.");
    return db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO retos_bloqueos (bloqueador, bloqueado, creado_en) VALUES (?, ?, ?)").run(a, b, Date.now());
        const pendientes = db
            .prepare("SELECT id FROM retos WHERE estado = 'pendiente' AND ((creador = ? AND rival = ?) OR (creador = ? AND rival = ?))")
            .pluck()
            .all(a, b, b, a);
        const devueltos = [];
        const pagos = [];
        for (const id of pendientes) {
            const hecho = devolver(id, "bloqueo");
            if (!hecho) continue;
            devueltos.push(hecho.reto);
            pagos.push(...hecho.pagos);
        }
        return { ok: true, devueltos, pagos };
    })();
}

/** El rival de un reto pendiente bloquea a quien le retó (botón 🚫 Bloquear del mensaje del reto). */
function bloquearDesdeReto(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (!reto.rival || reto.rival !== String(userId)) return error("⛔ Solo quien recibe el reto puede bloquear a quien lo lanzó.");
    return bloquear(userId, reto.creador);
}

/** Quita un bloqueo. @returns {boolean} si había alguno */
function desbloquear(bloqueador, otro) {
    return (
        db.prepare("DELETE FROM retos_bloqueos WHERE bloqueador = ? AND bloqueado = ?").run(String(bloqueador), String(otro)).changes === 1
    );
}

module.exports = { bloqueado, listarBloqueos, bloquear, bloquearDesdeReto, desbloquear };
