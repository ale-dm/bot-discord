// Avisos de los retos por DM: que le toca jugar a quien espera en un duelo (#452) y que un reto pendiente caduca pronto (#439).
// Aquí solo se decide a quién y qué; el envío (y las preferencias de /avisos) está en juegos/retos/retos.js.
const db = require("../../core/db");
const { DUENDE } = require("./constantes");
const { obtener, guardarDatos } = require("./persistencia");

/**
 * Tras una jugada de `quien` en un duelo, a quién hay que avisar de que le toca (#452), o null. Solo se avisa si el duelo
 * sigue en juego (si la jugada lo ha resuelto, el resultado ya sale en el canal), el otro aún no ha jugado y no es el Duende.
 * Se avisa una sola vez por persona y partida, para no saturar: queda apuntado en `datos.avisados`.
 * @returns {{ reto: object, userId: string } | null}
 */
function avisoDeTurno(retoId, quien) {
    const reto = obtener(retoId);
    if (!reto || reto.tipo !== "duelo" || reto.estado !== "en_juego" || !reto.datos) return null;
    const yo = String(quien);
    const otro = yo === reto.creador ? reto.rival : reto.creador;
    if (!otro || otro === DUENDE || ![reto.creador, reto.rival].includes(yo)) return null;
    const datos = reto.datos;
    let esperando = false;
    if (reto.juego === "ppt") esperando = Boolean(datos.jugadas?.[yo]) && !datos.jugadas?.[otro];
    else if (reto.juego === "blackjack") esperando = Boolean(datos.plantados?.[yo]) && !datos.plantados?.[otro];
    if (!esperando) return null;
    const avisados = datos.avisados || [];
    if (avisados.includes(otro)) return null;
    guardarDatos(reto.id, { ...datos, avisados: [...avisados, otro] });
    return { reto, userId: otro };
}

/**
 * Los retos pendientes a los que ya les queda la mitad del plazo o menos (#439), que aún no tienen recordatorio. Los marca
 * como recordados al devolverlos, así que cada reto se recuerda como mucho una vez. Solo los que tienen un rival concreto (un
 * reto abierto no tiene a quién avisar) y no es el Duende.
 */
function recordatoriosPendientes(ahora = Date.now()) {
    const ids = db
        .prepare(
            `SELECT id FROM retos
             WHERE estado = 'pendiente' AND rival IS NOT NULL AND rival != ? AND recordado_en IS NULL
               AND expira_en > ? AND creado_en + (expira_en - creado_en) / 2.0 <= ?`,
        )
        .pluck()
        .all(DUENDE, ahora, ahora);
    const marcar = db.prepare("UPDATE retos SET recordado_en = ? WHERE id = ? AND recordado_en IS NULL");
    return ids.filter((id) => marcar.run(ahora, id).changes === 1).map((id) => obtener(id));
}

module.exports = { avisoDeTurno, recordatoriosPendientes };
