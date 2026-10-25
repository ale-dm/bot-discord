// 🔁 Exchange (#533): las reglas comunes. Cuotas e importes válidos, el partido abierto y sin empezar, el riesgo de quien va en
// contra, la comisión (2 % de la ganancia neta, la paga quien gana) y la exposición de cada jugador (lo que tiene retenido) con
// sus límites: como mucho el 10 % de su capital por orden, el 25 % en un mismo partido y 100.000 en total. El capital es lo
// que puede gastar más lo que ya tiene retenido en el exchange.
const db = require("../../../core/db");
const dinero = require("../../dinero");

const ELECCIONES = ["home", "draw", "away"];
const COMISION_PCT = 2;
const MIN_CANTIDAD = 10;
const MIN_CUOTA = 1.1;
const MAX_CUOTA = 50;
const PCT_ORDEN = 10;
const PCT_PARTIDO = 25;
const TOPE_TOTAL = 100_000;
const ABIERTAS = ["abierta", "parcial"];

/** La comisión de una ganancia neta (redondeada; al menos 1 si hay ganancia). */
const comision = (neto) => (neto > 0 ? Math.max(1, Math.round((neto * COMISION_PCT) / 100)) : 0);

/** El riesgo de ir en contra de `cantidad` a `cuota`: lo que pierde si gana la orden. */
const riesgo = (cantidad, cuota) => Math.round(cantidad * (cuota - 1));

/** Una cuota escrita con coma o punto, con dos decimales, o null si no vale. */
function cuotaValida(texto) {
    const n = Number(
        String(texto ?? "")
            .replace(",", ".")
            .trim(),
    );
    if (!Number.isFinite(n) || n < MIN_CUOTA || n > MAX_CUOTA) return null;
    return Math.round(n * 100) / 100;
}

const cantidadValida = (n) => Number.isInteger(n) && n >= MIN_CANTIDAD;

/** El partido si está abierto y no ha empezado; si no, null. */
function partidoAbierto(matchId, ahora = Date.now()) {
    const p = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(String(matchId));
    if (!p || p.estado !== "abierto" || Date.parse(p.start_time) <= ahora) return null;
    return p;
}

/** Lo que tiene retenido alguien en el exchange (en un partido, si se da). */
function exposicion(userId, matchId = null) {
    const filtro = matchId ? " AND match_id = ?" : "";
    const params = matchId ? [String(userId), String(matchId)] : [String(userId)];
    const comoBack = db
        .prepare(
            `SELECT COALESCE(SUM(cantidad - devuelto), 0) AS n FROM exchange_ordenes
             WHERE user_id = ? AND estado IN ('abierta', 'parcial', 'casada')${filtro}`,
        )
        .get(...params).n;
    const comoLay = db
        .prepare(
            `SELECT COALESCE(SUM(c.riesgo), 0) AS n FROM exchange_cruces c JOIN exchange_ordenes o ON o.id = c.orden_id
             WHERE c.contraparte_id = ? AND c.estado = 'abierto'${matchId ? " AND o.match_id = ?" : ""}`,
        )
        .get(...params).n;
    return comoBack + comoLay;
}

/** ¿Puede retener `nuevo` más en ese partido? null si sí; si no, el motivo. */
function motivoLimite(userId, matchId, nuevo) {
    if (dinero.saldoGastable(userId) < nuevo) return "No te llega el efectivo.";
    const total = exposicion(userId);
    const capital = dinero.saldoGastable(userId) + total;
    const fmt = (n) => Math.floor(n).toLocaleString("es");
    if (nuevo > (capital * PCT_ORDEN) / 100)
        return `Como mucho el ${PCT_ORDEN} % de tu capital por orden (${fmt((capital * PCT_ORDEN) / 100)}).`;
    if (exposicion(userId, matchId) + nuevo > (capital * PCT_PARTIDO) / 100)
        return `Como mucho el ${PCT_PARTIDO} % de tu capital en un mismo partido (${fmt((capital * PCT_PARTIDO) / 100)}).`;
    if (total + nuevo > TOPE_TOTAL) return `Como mucho ${fmt(TOPE_TOTAL)} retenidos en el exchange a la vez.`;
    return null;
}

module.exports = {
    ELECCIONES,
    COMISION_PCT,
    MIN_CANTIDAD,
    MIN_CUOTA,
    MAX_CUOTA,
    PCT_ORDEN,
    PCT_PARTIDO,
    TOPE_TOTAL,
    ABIERTAS,
    comision,
    riesgo,
    cuotaValida,
    cantidadValida,
    partidoAbierto,
    exposicion,
    motivoLimite,
};
