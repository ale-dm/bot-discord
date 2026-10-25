// 🔁 Exchange (#533): liquidar los cruces de un partido con el mismo resultado que el resto de apuestas. En cada cruce, si gana
// la orden, quien la publicó se lleva su apuesta más el riesgo de la contraparte; si no, la contraparte se lleva su riesgo más
// la apuesta. Quien gana paga el 2 % de su ganancia neta. Si el partido se queda sin resultado, cada parte recupera lo suyo.
// Va dentro de la transacción de la liquidación y cada cruce cambia de estado una sola vez.
const db = require("../../../core/db");
const dinero = require("../../dinero");
const r = require("./reglas");
const { NOMBRE } = require("./libro");
const { logInfo } = require("../../../core/logger");

const crucesAbiertos = (matchId) =>
    db
        .prepare(
            `SELECT c.*, o.user_id AS backer, o.eleccion, o.id AS orden FROM exchange_cruces c JOIN exchange_ordenes o ON o.id = c.orden_id
             WHERE o.match_id = ? AND c.estado = 'abierto'`,
        )
        .all(String(matchId));

/** Devuelve lo no cruzado que quedara y deja las órdenes del partido como liquidadas. */
function cerrarOrdenes(matchId, ahora) {
    const sueltas = db
        .prepare("SELECT * FROM exchange_ordenes WHERE match_id = ? AND estado IN ('abierta', 'parcial')")
        .all(String(matchId));
    const pagos = [];
    for (const o of sueltas) {
        const resto = o.cantidad - o.casado - o.devuelto;
        if (resto > 0) {
            db.prepare("UPDATE exchange_ordenes SET devuelto = devuelto + ? WHERE id = ?").run(resto, o.id);
            dinero.pagar(o.user_id, resto);
            dinero.apuntar(o.user_id, "apuestas", `Exchange: devuelta la parte sin cruzar (orden #${o.id})`, resto);
            pagos.push({ userId: o.user_id, premio: resto, descripcion: "Exchange: parte sin cruzar", reembolso: true });
        }
    }
    db.prepare("UPDATE exchange_ordenes SET estado = 'liquidada', cerrada_en = ? WHERE match_id = ? AND estado != 'cancelada'").run(
        ahora,
        String(matchId),
    );
    return pagos;
}

/** Liquida los cruces de un partido con su resultado. @returns {{ userId, premio, descripcion }[]} */
function resolverPartido(matchId, resultado, ahora = Date.now()) {
    const pagos = [];
    for (const c of crucesAbiertos(matchId)) {
        const ganaOrden = c.eleccion === resultado;
        const ganador = ganaOrden ? c.backer : c.contraparte_id;
        const neto = ganaOrden ? c.riesgo : c.cantidad;
        const com = r.comision(neto);
        const pago = c.cantidad + c.riesgo - com;
        const { changes } = db
            .prepare(
                "UPDATE exchange_cruces SET estado = 'liquidado', ganador_id = ?, comision = ?, pago = ?, liquidado_en = ? WHERE id = ? AND estado = 'abierto'",
            )
            .run(ganador, com, pago, ahora, c.id);
        if (changes !== 1) continue;
        dinero.pagar(ganador, pago);
        dinero.apuntar(
            ganador,
            "apuestas",
            `Exchange ganado: ${ganaOrden ? "a favor" : "en contra"} de ${NOMBRE[c.eleccion]} (comisión ${com})`,
            pago,
        );
        pagos.push({ userId: ganador, premio: pago, descripcion: `Exchange ganado (comisión ${com})` });
    }
    pagos.push(...cerrarOrdenes(matchId, ahora));
    if (pagos.length) logInfo(`[Exchange] Partido ${matchId} liquidado: ${pagos.length} pagos`);
    return pagos;
}

/** El partido se queda sin resultado: cada cruce se anula y cada parte recupera lo suyo. */
function caducarPartido(matchId, ahora = Date.now()) {
    const pagos = [];
    for (const c of crucesAbiertos(matchId)) {
        const { changes } = db
            .prepare(
                "UPDATE exchange_cruces SET estado = 'anulado', pago = 0, comision = 0, liquidado_en = ? WHERE id = ? AND estado = 'abierto'",
            )
            .run(ahora, c.id);
        if (changes !== 1) continue;
        for (const [userId, cantidad] of [
            [c.backer, c.cantidad],
            [c.contraparte_id, c.riesgo],
        ]) {
            if (!cantidad) continue;
            dinero.pagar(userId, cantidad);
            dinero.apuntar(userId, "apuestas", "Reembolso: exchange de un partido sin resultado", cantidad);
            pagos.push({ userId, premio: cantidad, descripcion: "Reembolso del exchange (partido sin resultado)", reembolso: true });
        }
    }
    pagos.push(...cerrarOrdenes(matchId, ahora));
    return pagos;
}

module.exports = { resolverPartido, caducarPartido };
