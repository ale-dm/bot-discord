// 🔁 Exchange (#533): el libro de cada partido. Publicar una orden «a favor» (back) retiene lo apostado. Ir «en contra» es
// casar órdenes del libro: la entrada dice hasta qué cuota acepta (para ella, cuanto más baja mejor) y cuánto quiere cubrir;
// el motor cruza primero la cuota más baja y, a igual cuota, la orden más antigua, aunque sea en parte, y retiene el riesgo de
// quien casa. Manda siempre la cuota publicada. Lo no casado se puede cancelar y se devuelve; al empezar el partido se devuelve
// solo. Todo dinero pasa por dinero.js y cada operación va en una transacción sin esperas entre la comprobación y el cobro.
const db = require("../../../core/db");
const dinero = require("../../dinero");
const r = require("./reglas");
const { logInfo } = require("../../../core/logger");

const NOMBRE = { home: "local", draw: "empate", away: "visitante" };

function validar({ matchId, eleccion, cuota, cantidad }, ahora) {
    const partido = r.partidoAbierto(matchId, ahora);
    if (!partido) return { motivo: "Ese partido ya ha empezado o no está abierto." };
    if (!r.ELECCIONES.includes(eleccion)) return { motivo: "Elige local, empate o visitante." };
    if (!cuota) return { motivo: `La cuota va de ${r.MIN_CUOTA} a ${r.MAX_CUOTA}.` };
    if (!r.cantidadValida(cantidad)) return { motivo: `El importe mínimo es ${r.MIN_CANTIDAD}.` };
    return { partido };
}

/** Publica una orden a favor. @returns {{ ok: true, id } | { ok: false, motivo }} */
function publicar({ userId, matchId, eleccion, cuota, cantidad }, ahora = Date.now()) {
    const v = validar({ matchId, eleccion, cuota, cantidad }, ahora);
    if (v.motivo) return { ok: false, motivo: v.motivo };
    const limite = r.motivoLimite(userId, matchId, cantidad);
    if (limite) return { ok: false, motivo: limite };
    const id = db.transaction(() => {
        if (!dinero.cobrarCombinado(userId, cantidad)) return null;
        const { lastInsertRowid } = db
            .prepare("INSERT INTO exchange_ordenes (user_id, match_id, eleccion, cuota, cantidad, creada_en) VALUES (?, ?, ?, ?, ?, ?)")
            .run(String(userId), String(matchId), eleccion, cuota, cantidad, ahora);
        dinero.apuntar(
            userId,
            "apuestas",
            `Exchange: a favor de ${NOMBRE[eleccion]} en ${v.partido.home_team} vs ${v.partido.away_team} @${cuota}`,
            -cantidad,
        );
        return Number(lastInsertRowid);
    })();
    if (id === null) return { ok: false, motivo: "No te llega el efectivo." };
    logInfo(`[Exchange] ${userId} publica ${cantidad} a ${eleccion} @${cuota} en ${matchId} (#${id})`);
    return { ok: true, id };
}

/**
 * Qué cruzaría ir en contra de `eleccion` hasta `cuotaMax` por `cantidad` (lo apostado a favor que se quiere cubrir), sin
 * cobrar nada: [{ ordenId, cantidad, cuota, riesgo }], el total cubierto y el riesgo total.
 */
function previsualizar({ userId, matchId, eleccion, cuotaMax, cantidad }) {
    const enLibro = db
        .prepare(
            `SELECT * FROM exchange_ordenes WHERE match_id = ? AND eleccion = ? AND estado IN ('abierta', 'parcial') AND cuota <= ?
               AND user_id != ? ORDER BY cuota ASC, creada_en ASC, id ASC`,
        )
        .all(String(matchId), eleccion, cuotaMax, String(userId));
    const cruces = [];
    let restante = cantidad;
    for (const o of enLibro) {
        if (restante <= 0) break;
        const tomar = Math.min(o.cantidad - o.casado - o.devuelto, restante);
        if (tomar <= 0) continue;
        cruces.push({ ordenId: o.id, cantidad: tomar, cuota: o.cuota, riesgo: r.riesgo(tomar, o.cuota) });
        restante -= tomar;
    }
    return {
        cruces,
        cubierto: cantidad - restante,
        riesgo: cruces.reduce((t, c) => t + c.riesgo, 0),
    };
}

/**
 * Va en contra: cruza con el libro y retiene el riesgo. Si alguien cruzó antes una de esas órdenes, no se cobra nada y hay
 * que volver a intentarlo. @returns {{ ok: true, cruces, cubierto, riesgo } | { ok: false, motivo }}
 */
function casar({ userId, matchId, eleccion, cuotaMax, cantidad }, ahora = Date.now()) {
    const v = validar({ matchId, eleccion, cuota: cuotaMax, cantidad }, ahora);
    if (v.motivo) return { ok: false, motivo: v.motivo };
    const plan = previsualizar({ userId, matchId, eleccion, cuotaMax, cantidad });
    if (!plan.cruces.length) return { ok: false, motivo: "No hay órdenes a esa cuota o mejor para cruzar." };
    const limite = r.motivoLimite(userId, matchId, plan.riesgo);
    if (limite) return { ok: false, motivo: limite };
    const hecho = db.transaction(() => {
        for (const c of plan.cruces) {
            const { changes } = db
                .prepare(
                    `UPDATE exchange_ordenes SET casado = casado + ?,
                         estado = CASE WHEN casado + ? + devuelto >= cantidad THEN 'casada' ELSE 'parcial' END
                     WHERE id = ? AND estado IN ('abierta', 'parcial') AND casado + ? + devuelto <= cantidad`,
                )
                .run(c.cantidad, c.cantidad, c.ordenId, c.cantidad);
            if (changes !== 1) throw new Error("orden ya cruzada");
            db.prepare(
                "INSERT INTO exchange_cruces (orden_id, contraparte_id, cantidad, cuota, riesgo, creado_en) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(c.ordenId, String(userId), c.cantidad, c.cuota, c.riesgo, ahora);
        }
        if (!dinero.cobrarCombinado(userId, plan.riesgo)) throw new Error("sin saldo");
        dinero.apuntar(
            userId,
            "apuestas",
            `Exchange: en contra de ${NOMBRE[eleccion]} en ${v.partido.home_team} vs ${v.partido.away_team}`,
            -plan.riesgo,
        );
        return true;
    });
    try {
        hecho();
    } catch (e) {
        return { ok: false, motivo: e.message === "sin saldo" ? "No te llega el efectivo." : "El libro ha cambiado: vuelve a intentarlo." };
    }
    logInfo(`[Exchange] ${userId} cruza ${plan.cubierto} en contra de ${eleccion} en ${matchId} (riesgo ${plan.riesgo})`);
    return { ok: true, ...plan };
}

/** Devuelve lo no cruzado de una orden y la cierra (`cancelada` si no se cruzó nada; si no, `casada`). */
function devolverResto(o, ahora, motivo) {
    const resto = o.cantidad - o.casado - o.devuelto;
    if (resto <= 0) return 0;
    const estado = o.casado > 0 ? "casada" : "cancelada";
    const { changes } = db
        .prepare(
            "UPDATE exchange_ordenes SET devuelto = devuelto + ?, estado = ?, cerrada_en = ? WHERE id = ? AND estado IN ('abierta', 'parcial')",
        )
        .run(resto, estado, ahora, o.id);
    if (changes !== 1) return 0;
    dinero.pagar(o.user_id, resto);
    dinero.apuntar(o.user_id, "apuestas", `Exchange: ${motivo} (orden #${o.id})`, resto);
    return resto;
}

/** Cancela lo no cruzado de una orden suya. @returns {{ ok: true, devuelto } | { ok: false, motivo }} */
function cancelar(userId, ordenId, ahora = Date.now()) {
    const devuelto = db.transaction(() => {
        const o = db
            .prepare("SELECT * FROM exchange_ordenes WHERE id = ? AND user_id = ? AND estado IN ('abierta', 'parcial')")
            .get(Number(ordenId), String(userId));
        return o ? devolverResto(o, ahora, "cancelada la parte sin cruzar") : 0;
    })();
    return devuelto ? { ok: true, devuelto } : { ok: false, motivo: "Esa orden ya no tiene nada sin cruzar." };
}

/** Al empezar un partido, lo no cruzado de sus órdenes se devuelve: nunca queda dinero retenido sin contraparte. */
function cerrarAlEmpezar(ahora = Date.now()) {
    const ordenes = db
        .prepare(
            `SELECT o.* FROM exchange_ordenes o JOIN apuestas_partidos p ON p.match_id = o.match_id
             WHERE o.estado IN ('abierta', 'parcial') AND (p.start_time <= ? OR p.estado != 'abierto')`,
        )
        .all(new Date(ahora).toISOString());
    let total = 0;
    db.transaction(() => {
        for (const o of ordenes) total += devolverResto(o, ahora, "el partido empezó sin contraparte");
    })();
    if (ordenes.length) logInfo(`[Exchange] Al empezar: devueltas ${total} monedas de ${ordenes.length} órdenes sin cruzar`);
    return total;
}

/** El libro de un partido: por elección, cada cuota con lo disponible, de la mejor (más baja) a la peor. */
function libro(matchId) {
    const filas = db
        .prepare(
            `SELECT eleccion, cuota, SUM(cantidad - casado - devuelto) AS disponible, COUNT(*) AS ordenes FROM exchange_ordenes
             WHERE match_id = ? AND estado IN ('abierta', 'parcial') GROUP BY eleccion, cuota ORDER BY cuota ASC`,
        )
        .all(String(matchId));
    return Object.fromEntries(r.ELECCIONES.map((e) => [e, filas.filter((f) => f.eleccion === e && f.disponible > 0)]));
}

/** Las órdenes y los cruces de alguien, para «Mis órdenes». */
function deUsuario(userId, limite = 10) {
    const ordenes = db
        .prepare(
            `SELECT o.*, p.home_team, p.away_team FROM exchange_ordenes o LEFT JOIN apuestas_partidos p ON p.match_id = o.match_id
             WHERE o.user_id = ? ORDER BY o.id DESC LIMIT ?`,
        )
        .all(String(userId), limite);
    const enContra = db
        .prepare(
            `SELECT c.*, o.eleccion, o.match_id, p.home_team, p.away_team FROM exchange_cruces c
             JOIN exchange_ordenes o ON o.id = c.orden_id LEFT JOIN apuestas_partidos p ON p.match_id = o.match_id
             WHERE c.contraparte_id = ? ORDER BY c.id DESC LIMIT ?`,
        )
        .all(String(userId), limite);
    return { ordenes, enContra };
}

module.exports = { NOMBRE, publicar, previsualizar, casar, cancelar, cerrarAlEmpezar, libro, deUsuario };
