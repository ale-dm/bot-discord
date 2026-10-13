// SQL de las estadísticas del casino que pintan el panel 🎰 Casino y el blackjack. Las reglas de cada juego están en
// systems/casino y systems/casinoTransactions; aquí solo las consultas, tal cual (#473). `sql` y `params` son el filtro por juego
// que arma el panel (nunca texto escrito por quien juega).
const db = require("../core/db");

const resumenJugador = (userId, sql, params) =>
    db
        .prepare(
            `
        SELECT COUNT(*)                                              AS total,
               COALESCE(SUM(apuesta),   0)                           AS apostado,
               COALESCE(SUM(resultado), 0)                           AS ganancia,
               COALESCE(MAX(resultado), 0)                           AS mejor,
               COUNT(CASE WHEN resultado > 0 THEN 1 END)             AS wins,
               COUNT(CASE WHEN resultado < 0 THEN 1 END)             AS losses
        FROM casino WHERE userId = ?${sql}
    `,
        )
        .get(userId, ...params);

const juegoFavorito = (userId) =>
    db.prepare("SELECT juego, COUNT(*) AS cnt FROM casino WHERE userId = ? GROUP BY juego ORDER BY cnt DESC LIMIT 1").get(userId);

const ultimasPartidas = (userId, n) =>
    db.prepare("SELECT juego, resultado, apuesta FROM casino WHERE userId = ? ORDER BY fecha DESC LIMIT ?").all(userId, n);

const porJuego = (userId, sql, params) =>
    db
        .prepare(
            `
        SELECT juego, COUNT(*) AS p, SUM(resultado) AS g,
               COUNT(CASE WHEN resultado > 0 THEN 1 END) AS w
        FROM casino WHERE userId = ?${sql} GROUP BY juego ORDER BY p DESC
    `,
        )
        .all(userId, ...params);

const historialReciente = (userId) =>
    db
        .prepare(
            `
        SELECT juego, fecha, apuesta, resultado FROM casino
        WHERE userId = ? ORDER BY fecha DESC LIMIT 15
    `,
        )
        .all(userId);

const ranking = () =>
    db
        .prepare(
            `
        SELECT u.nombre, COUNT(c.id) AS partidas, SUM(c.resultado) AS gananciaTotal,
               COUNT(CASE WHEN c.resultado > 0 THEN 1 END) AS victorias
        FROM casino c
        JOIN usuarios u ON c.userId = u.id
        GROUP BY c.userId, u.nombre HAVING partidas >= 5
        ORDER BY gananciaTotal DESC LIMIT 10
    `,
        )
        .all();

const estadisticasBlackjack = (userId) =>
    db
        .prepare(
            `
        SELECT
            COUNT(*) as partidas,
            SUM(CASE WHEN resultado > 0 THEN 1 ELSE 0 END) as victorias,
            SUM(CASE WHEN resultado = 0 THEN 1 ELSE 0 END) as empates,
            SUM(resultado) as gananciaTotal,
            MAX(resultado) as mejorGanancia
        FROM casino
        WHERE userId = ? AND juego = 'blackjack'
    `,
        )
        .get(userId);

module.exports = { resumenJugador, juegoFavorito, ultimasPartidas, porJuego, historialReciente, ranking, estadisticasBlackjack };

/** Lo ganado y lo perdido en total por alguien en el casino (para las herramientas del Duende). */
const totalesCasino = (userId) =>
    db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0) AS ganado,
                        COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0) AS perdido
                 FROM casino WHERE userId = ?`,
        )
        .get(userId);

module.exports.totalesCasino = totalesCasino;
