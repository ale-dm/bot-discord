// Cancelar una combinada (#296): mientras ninguno de sus partidos haya empezado, se devuelve todo lo apostado al 💵 efectivo, sin
// comisión (a diferencia de una apuesta suelta). La combinada queda como «cancelada» (con lo devuelto como premio, así que no cambia el
// beneficio): se ve en 📋 Mis jugadas → 📋 Resueltas y en el historial de dinero. Se hace desde 📋 Mis jugadas → ⏳ En juego.
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

/** Sus combinadas abiertas con todos los partidos por empezar, con sus patas; la que antes empieza, primero. */
function cancelables(userId, ahora = Date.now()) {
    const abiertas = db
        .prepare(
            "SELECT id, user_id, cantidad, cuota, estado, creada_en FROM combinadas WHERE user_id = ? AND estado = 'abierta' ORDER BY id",
        )
        .all(String(userId));
    const patasDe = db.prepare(
        `SELECT pa.*, p.home_team, p.away_team, p.start_time, p.estado AS estado_partido
         FROM combinada_patas pa LEFT JOIN apuestas_partidos p ON p.match_id = pa.match_id WHERE pa.combinada_id = ? ORDER BY pa.id`,
    );
    const sinEmpezar = (pata) => pata.estado_partido === "abierto" && Date.parse(pata.start_time) > ahora;
    return abiertas
        .map((c) => ({ ...c, patas: patasDe.all(c.id) }))
        .filter((c) => c.patas.length > 0 && c.patas.every(sinEmpezar))
        .map((c) => ({ ...c, primerInicio: c.patas.map((p) => p.start_time).sort()[0] }))
        .sort((a, b) => a.primerInicio.localeCompare(b.primerInicio) || a.id - b.id);
}

/** Una combinada suya que aún se puede cancelar, o null. */
function cancelable(userId, combinadaId, ahora = Date.now()) {
    return cancelables(userId, ahora).find((c) => c.id === Number(combinadaId)) || null;
}

/**
 * Cancela la combinada y devuelve lo apostado entero, todo o nada (dos clics a la vez no la pueden devolver dos veces).
 * @returns {{ ok: boolean, mensaje: string, devolucion?: number }}
 */
function cancelar(userId, combinadaId, ahora = Date.now()) {
    const c = db.transaction(() => {
        const combinada = cancelable(userId, combinadaId, ahora);
        if (!combinada) return null;
        const cambio = db.prepare("UPDATE combinadas SET estado = 'cancelada', premio = ? WHERE id = ? AND estado = 'abierta'");
        if (cambio.run(combinada.cantidad, combinada.id).changes !== 1) return null;
        db.prepare("UPDATE combinada_patas SET resultado = 'cancelada' WHERE combinada_id = ? AND resultado = 'pendiente'").run(
            combinada.id,
        );
        dinero.pagar(userId, combinada.cantidad);
        dinero.apuntar(userId, "apuestas", `Combinada cancelada de ${combinada.patas.length} partidos (sin comisión)`, combinada.cantidad);
        return combinada;
    })();
    if (!c) return { ok: false, mensaje: "❌ Esa combinada ya no se puede cancelar: algún partido ha empezado o ya no está en juego." };
    log.info(`${userId} canceló su combinada ${c.id} (${c.patas.length} partidos, ${c.cantidad}): devuelta entera`);
    return {
        ok: true,
        devolucion: c.cantidad,
        mensaje: `↩️ Combinada cancelada (${c.patas.length} partidos). Te he devuelto **${c.cantidad.toLocaleString("es")}** 🪙, sin comisión.`,
    };
}

module.exports = { cancelables, cancelable, cancelar };
