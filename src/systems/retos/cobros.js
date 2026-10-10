// Dinero de los retos: cobrar la entrada, cerrar un reto y pagar lo que toque (ganar, devolver).
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");
const { DUENDE } = require("./constantes");
const { descripcion } = require("./comun");
const { obtener } = require("./persistencia");

const log = createLogger("Retos");

/** Cobra la entrada y apunta a alguien en el reto (al Duende no se le cobra). Va dentro de una transacción. @returns {boolean} */
function unir(reto, userId, opcion = null) {
    const duende = String(userId) === DUENDE;
    if (!duende && !dinero.cobrar(userId, reto.cantidad)) return false;
    db.prepare("INSERT INTO retos_participantes (reto_id, userId, opcion, cantidad, unido_en) VALUES (?, ?, ?, ?, ?)").run(
        reto.id,
        String(userId),
        opcion,
        reto.cantidad,
        Date.now(),
    );
    if (!duende) dinero.apuntar(userId, "retos", `Reto: ${descripcion(reto)}`, -reto.cantidad);
    return true;
}

/**
 * Cierra un reto que sigue abierto, con lo que recibe cada participante (`premios`: userId → monedas). Si ya estaba
 * cerrado (dos clics a la vez, el cron y un botón...) no hace nada y devuelve null.
 * @returns {{ reto: object, pagos: Array<{userId, premio, descripcion, reembolso}> } | null}
 */
function cerrar(retoId, premios, estado, resultado) {
    return db.transaction(() => {
        const ahora = Date.now();
        const r = db
            .prepare(
                "UPDATE retos SET estado = ?, resultado = ?, resuelto_en = ?, actualizado_en = ? WHERE id = ? AND estado NOT IN ('resuelto', 'devuelto')",
            )
            .run(estado, resultado, ahora, ahora, retoId);
        if (r.changes !== 1) return null;
        const reto = obtener(retoId);
        const desc = descripcion(reto);
        const reembolso = estado === "devuelto";
        const pagos = [];
        for (const p of reto.participantes) {
            const premio = premios[p.userId] || 0;
            db.prepare("UPDATE retos_participantes SET premio = ? WHERE reto_id = ? AND userId = ?").run(premio, retoId, p.userId);
            // Lo que gana el Duende no va a nadie: desaparece (como en el casino).
            if (premio <= 0 || p.userId === DUENDE) continue;
            dinero.pagarConImpuesto(
                p.userId,
                reto.guildId,
                "retos",
                reembolso ? `Reto devuelto: ${desc} (${resultado})` : `Reto ganado: ${desc}`,
                premio,
            );
            pagos.push({
                userId: p.userId,
                premio,
                descripcion: reembolso ? `Reembolso: ${desc}, ${resultado}` : `reto: ${desc}`,
                reembolso,
            });
        }
        log.info(
            `Reto ${retoId} (${reto.tipo}) ${estado}: ${resultado} · ${pagos.map((p) => `${p.userId} +${p.premio}`).join(", ") || "sin pagos"}`,
        );
        return { reto: obtener(retoId), pagos };
    })();
}

/** Devuelve a cada participante lo que puso. */
function devolver(retoId, motivo) {
    const reto = obtener(retoId);
    if (!reto) return null;
    return cerrar(retoId, Object.fromEntries(reto.participantes.map((p) => [p.userId, p.cantidad])), "devuelto", motivo);
}

/** Reparte todo el bote entre `ganadores` (a partes iguales; lo que sobra de la división, al primero). */
function ganar(retoId, ganadores, resultado) {
    const reto = obtener(retoId);
    if (!reto || !ganadores.length) return null;
    const bote = reto.participantes.reduce((s, p) => s + p.cantidad, 0);
    const parte = Math.floor(bote / ganadores.length);
    const premios = Object.fromEntries(ganadores.map((id, n) => [String(id), parte + (n === 0 ? bote - parte * ganadores.length : 0)]));
    return cerrar(retoId, premios, "resuelto", resultado);
}

module.exports = { unir, cerrar, devolver, ganar };
