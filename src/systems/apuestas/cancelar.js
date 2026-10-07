// Cancelar una apuesta a un partido (F-AP-05): mientras el partido no haya empezado, se devuelve lo apostado al 💵
// efectivo menos una pequeña comisión (que desaparece). La apuesta se borra, así que no cuenta en las estadísticas ni en
// el ranking; en el historial quedan la apuesta y la devolución. Se hace desde /juegos → 📋 Mis jugadas → ⏳ En juego.
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

/** % de lo apostado que se queda la casa al cancelar (como mínimo 1 moneda). */
const COMISION_PCT = 10;

const comision = (cantidad) => Math.max(1, Math.ceil((cantidad * COMISION_PCT) / 100));

const CON_PARTIDO = `SELECT a.*, p.home_team, p.away_team, p.start_time, p.estado
     FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id`;

/** Sus apuestas que aún se pueden cancelar (partido abierto y sin empezar), la más próxima primero. */
function cancelables(userId, ahora = Date.now()) {
    return db
        .prepare(
            `${CON_PARTIDO} WHERE a.user_id = ? AND a.pagado = 0 AND p.estado = 'abierto' AND p.start_time > ? ORDER BY p.start_time, a.id`,
        )
        .all(String(userId), new Date(ahora).toISOString())
        .map((a) => ({ ...a, comision: comision(a.cantidad), devolucion: a.cantidad - comision(a.cantidad) }));
}

/** Una apuesta suya que aún se puede cancelar, o null. */
function cancelable(userId, apuestaId, ahora = Date.now()) {
    return cancelables(userId, ahora).find((a) => a.id === Number(apuestaId)) || null;
}

/**
 * Cancela la apuesta: la borra y devuelve lo apostado menos la comisión, todo o nada (dos clics a la vez no la pueden
 * devolver dos veces). @returns {{ ok: boolean, mensaje: string, devolucion?: number, comision?: number }}
 */
function cancelar(userId, apuestaId, ahora = Date.now()) {
    const r = db.transaction(() => {
        const a = cancelable(userId, apuestaId, ahora);
        if (!a) return null;
        if (db.prepare("DELETE FROM apuestas_usuario WHERE id = ? AND pagado = 0").run(a.id).changes !== 1) return null;
        dinero.pagar(userId, a.devolucion);
        dinero.apuntar(userId, "apuestas", `Apuesta cancelada: ${a.home_team} vs ${a.away_team} (comisión de ${a.comision})`, a.devolucion);
        return a;
    })();
    if (!r) {
        return { ok: false, mensaje: "❌ Esa apuesta ya no se puede cancelar: el partido ha empezado o ya no está en juego." };
    }
    log.info(`${userId} canceló su apuesta ${r.id} (${r.home_team} vs ${r.away_team}, ${r.cantidad}): devueltas ${r.devolucion}`);
    return {
        ok: true,
        devolucion: r.devolucion,
        comision: r.comision,
        mensaje:
            `↩️ Apuesta cancelada: **${r.home_team} vs ${r.away_team}**. Te he devuelto **${r.devolucion.toLocaleString("es")}** 🪙 ` +
            `(${r.cantidad.toLocaleString("es")} menos ${r.comision.toLocaleString("es")} de comisión).`,
    };
}

module.exports = { COMISION_PCT, comision, cancelables, cancelable, cancelar };
