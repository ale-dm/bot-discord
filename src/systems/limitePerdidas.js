// 🛡️ Límite de pérdidas personal (#319): cada persona puede ponerse, voluntariamente, un tope de lo que pierde en el casino y las
// apuestas por día o por semana (hora de Madrid). Con el tope alcanzado, o si una apuesta lo pasaría, no se le deja apostar hasta
// que empiece el periodo siguiente. Bajar el límite vale al momento; subirlo, cambiar a un periodo más holgado o quitarlo tarda 24 h
// (para no quitárselo en mitad de una mala racha).
//
// Las pérdidas son netas del periodo: lo apuntado en el historial como 🎰 casino (el resultado de cada partida) y ⚽ apuestas (cada
// apuesta en negativo al hacerla y cada premio o devolución en positivo), así que una apuesta sin resolver cuenta como perdida
// hasta que se cobra.
const db = require("../core/db");
const { momentoMadrid } = require("../core/zonaMadrid");
const { fmtNumero } = require("../core/formato");

const ESPERA_CAMBIO_MS = 24 * 60 * 60 * 1000;
const PERIODOS = { dia: "día", semana: "semana" };
const LIMITE_MAX = 1_000_000_000;

/** Lo que cabe en una semana con ese límite: sirve para saber si un cambio baja el límite (vale ya) o lo sube (espera 24 h). */
const capacidadSemanal = (limite, periodo) => (periodo === "dia" ? limite * 7 : limite);

/** El lunes (AAAA-MM-DD) de la semana de un día de Madrid. */
function lunesDe(dia) {
    const fecha = new Date(`${dia}T00:00:00Z`);
    fecha.setUTCDate(fecha.getUTCDate() - ((fecha.getUTCDay() + 6) % 7));
    return fecha.toISOString().slice(0, 10);
}

/** Lo que ha perdido en el periodo en curso (casino y apuestas, neto): 0 si va ganando. */
function perdidasDelPeriodo(userId, periodo, ahora = Date.now()) {
    const hoy = momentoMadrid(ahora).dia;
    const desde = periodo === "semana" ? lunesDe(hoy) : hoy;
    // Un margen de nueve días en SQL (las fechas son texto ISO en UTC) y el periodo exacto, en hora de Madrid.
    const neto = db
        .prepare("SELECT fecha, cantidad FROM historial WHERE userId = ? AND tipo IN ('casino', 'apuestas') AND fecha >= ?")
        .all(String(userId), new Date(ahora - 9 * 86400 * 1000).toISOString())
        .filter((f) => momentoMadrid(new Date(f.fecha)).dia >= desde)
        .reduce((total, f) => total + f.cantidad, 0);
    return Math.max(0, -neto);
}

/**
 * El límite de una persona ahora: { limite, periodo, pendiente } o null si no tiene. Aplica antes el cambio pendiente si ya han
 * pasado las 24 h. `pendiente`: { limite (0 = quitarlo), periodo, aplicaEn } o null.
 */
function estado(userId, ahora = Date.now()) {
    const fila = db.prepare("SELECT * FROM limite_perdidas WHERE userId = ?").get(String(userId));
    if (!fila) return null;
    if (fila.pend_aplica_en && ahora >= fila.pend_aplica_en) {
        if (fila.pend_limite === 0) {
            db.prepare("DELETE FROM limite_perdidas WHERE userId = ?").run(fila.userId);
            return null;
        }
        db.prepare(
            "UPDATE limite_perdidas SET limite = ?, periodo = ?, pend_limite = NULL, pend_periodo = NULL, pend_aplica_en = NULL WHERE userId = ?",
        ).run(fila.pend_limite, fila.pend_periodo, fila.userId);
        return { limite: fila.pend_limite, periodo: fila.pend_periodo, pendiente: null };
    }
    const pendiente = fila.pend_aplica_en ? { limite: fila.pend_limite, periodo: fila.pend_periodo, aplicaEn: fila.pend_aplica_en } : null;
    return { limite: fila.limite, periodo: fila.periodo, pendiente };
}

/**
 * Pone o cambia el límite. Si no hay uno, o el nuevo es más estricto (cabe menos en una semana), vale al momento; si es más holgado,
 * queda pendiente 24 h y mientras tanto sigue el actual.
 * @returns {{ ok: boolean, motivo?: string, inmediato?: boolean, aplicaEn?: number }}
 */
function fijar(userId, limite, periodo, ahora = Date.now()) {
    const valor = Number(limite);
    if (!PERIODOS[periodo]) return { ok: false, motivo: "El periodo es por día o por semana." };
    if (!Number.isInteger(valor) || valor < 1 || valor > LIMITE_MAX) {
        return { ok: false, motivo: `El límite es un número entero de monedas, de 1 a ${fmtNumero(LIMITE_MAX)}.` };
    }
    const actual = estado(userId, ahora);
    if (!actual) {
        db.prepare("INSERT OR REPLACE INTO limite_perdidas (userId, limite, periodo, creado_en) VALUES (?, ?, ?, ?)").run(
            String(userId),
            valor,
            periodo,
            ahora,
        );
        return { ok: true, inmediato: true };
    }
    if (capacidadSemanal(valor, periodo) <= capacidadSemanal(actual.limite, actual.periodo)) {
        db.prepare(
            "UPDATE limite_perdidas SET limite = ?, periodo = ?, pend_limite = NULL, pend_periodo = NULL, pend_aplica_en = NULL WHERE userId = ?",
        ).run(valor, periodo, String(userId));
        return { ok: true, inmediato: true };
    }
    const aplicaEn = ahora + ESPERA_CAMBIO_MS;
    db.prepare("UPDATE limite_perdidas SET pend_limite = ?, pend_periodo = ?, pend_aplica_en = ? WHERE userId = ?").run(
        valor,
        periodo,
        aplicaEn,
        String(userId),
    );
    return { ok: true, inmediato: false, aplicaEn };
}

/** Pide quitar el límite: tarda 24 h en aplicarse. @returns {{ ok: boolean, motivo?: string, aplicaEn?: number }} */
function quitar(userId, ahora = Date.now()) {
    const actual = estado(userId, ahora);
    if (!actual) return { ok: false, motivo: "No tienes ningún límite de pérdidas." };
    if (actual.pendiente?.limite === 0) return { ok: true, aplicaEn: actual.pendiente.aplicaEn }; // ya pedido: no se reinicia la espera
    const aplicaEn = ahora + ESPERA_CAMBIO_MS;
    db.prepare("UPDATE limite_perdidas SET pend_limite = 0, pend_periodo = ?, pend_aplica_en = ? WHERE userId = ?").run(
        actual.periodo,
        aplicaEn,
        String(userId),
    );
    return { ok: true, aplicaEn };
}

/**
 * ¿Puede apostar `cantidad`? El motivo si alcanzaría su límite de pérdidas (ya lo ha alcanzado, o esta apuesta lo pasaría
 * si se pierde), o null si puede. Sin límite, siempre puede.
 */
function motivoDeBloqueo(userId, cantidad, ahora = Date.now()) {
    const actual = estado(userId, ahora);
    if (!actual) return null;
    const perdidas = perdidasDelPeriodo(userId, actual.periodo, ahora);
    if (perdidas + cantidad <= actual.limite) return null;
    const hasta = actual.periodo === "dia" ? "mañana" : "el lunes";
    const tope = `Tu límite de pérdidas es de **${fmtNumero(actual.limite)}** 🪙 por ${PERIODOS[actual.periodo]}`;
    if (perdidas >= actual.limite) return `${tope} y ya lo has alcanzado: no puedes apostar hasta ${hasta} (hora de Madrid).`;
    const queda = actual.limite - perdidas;
    return `${tope} y llevas perdidos **${fmtNumero(perdidas)}** 🪙: esta apuesta lo pasaría. Como mucho puedes apostar **${fmtNumero(queda)}** 🪙 más hasta ${hasta}.`;
}

module.exports = {
    ESPERA_CAMBIO_MS,
    PERIODOS,
    perdidasDelPeriodo,
    estado,
    fijar,
    quitar,
    motivoDeBloqueo,
};
