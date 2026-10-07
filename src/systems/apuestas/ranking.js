// Ranking de apostadores (F-AP-03): beneficio, % de acierto y mejor racha de cada uno, con lo que ya se guarda de cada
// apuesta (su premio: 0 si se perdió). Lo enseña /perfil → 🏆 Rankings → ⚽ Apostadores.
//
// El beneficio es el mismo que el de 📊 Stats (partidos y quinielas ya resueltos, ver misJugadas.estadisticas); el
// acierto y la racha, solo de las apuestas a partidos (una quiniela no se gana o se pierde entera).
const db = require("../../core/db");
const { estadisticas } = require("./misJugadas");

/** Apuestas resueltas (partidos y quinielas) que hacen falta para salir en el ranking. */
const MIN_RESUELTAS = 5;

/** Cuántas apuestas a partidos ganó seguidas como mucho, por orden de partido. */
function mejorRacha(userId) {
    const filas = db
        .prepare(
            `SELECT a.premio FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.user_id = ? AND p.estado = 'finalizado' AND a.premio IS NOT NULL
             ORDER BY p.start_time, a.id`,
        )
        .all(userId);
    let mejor = 0;
    let actual = 0;
    for (const f of filas) {
        actual = f.premio > 0 ? actual + 1 : 0;
        mejor = Math.max(mejor, actual);
    }
    return mejor;
}

/** Las cifras de un apostador: beneficio, apuestas resueltas, acierto (null sin partidos resueltos) y mejor racha. */
function cifras(userId) {
    const { partidos: p, quinielas: q } = estadisticas(userId);
    const decididas = p.ganadas + p.perdidas;
    return {
        userId,
        beneficio: p.ganado - p.apostado + (q.ganado - q.apostado),
        resueltas: decididas + (q.total - q.pendientes),
        ganadas: p.ganadas,
        perdidas: p.perdidas,
        acierto: decididas ? (p.ganadas / decididas) * 100 : null,
        racha: mejorRacha(userId),
    };
}

/**
 * Los mejores apostadores por beneficio (a igualdad, más acierto), de quienes tienen al menos `minimo` apuestas resueltas.
 * @returns {{ userId: string, beneficio: number, resueltas: number, ganadas: number, perdidas: number, acierto: number|null, racha: number }[]}
 */
function ranking({ limite = 10, minimo = MIN_RESUELTAS } = {}) {
    const ids = db
        .prepare("SELECT user_id FROM apuestas_usuario UNION SELECT user_id FROM quiniela_apuestas")
        .all()
        .map((r) => r.user_id)
        .filter(Boolean);
    return ids
        .map(cifras)
        .filter((c) => c.resueltas >= minimo)
        .sort((a, b) => b.beneficio - a.beneficio || (b.acierto ?? -1) - (a.acierto ?? -1))
        .slice(0, limite);
}

module.exports = { MIN_RESUELTAS, mejorRacha, cifras, ranking };
