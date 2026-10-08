// Lo que alguien tiene apostado: partidos sueltos, quinielas (con sus pronósticos y aciertos) y sus
// estadísticas, más las últimas partidas del casino. Sin Discord: lo pintan paneles/misJugadas y la quiniela.
const db = require("../../core/db");
const mercados = require("./mercados");

const SIGNO = { home: "1", draw: "X", away: "2" };

/** Apuestas a partidos. `pendientes`: solo las de partidos sin resultado; si no, las ya resueltas. */
function partidosDe(userId, { pendientes = true, limite = 10 } = {}) {
    return db
        .prepare(
            `SELECT a.*, p.home_team, p.away_team, p.start_time, p.estado, p.resultado
             FROM apuestas_usuario a JOIN apuestas_partidos p ON a.match_id = p.match_id
             WHERE a.user_id = ? AND p.estado ${pendientes ? "= 'abierto'" : "!= 'abierto'"}
             ORDER BY p.start_time ${pendientes ? "ASC" : "DESC"} LIMIT ?`,
        )
        .all(userId, limite);
}

/**
 * Los pronósticos de una quiniela partido a partido: qué pusiste, qué salió (si ya se sabe) y si
 * acertaste. `aciertos` cuenta solo los partidos ya jugados.
 */
function detalleQuiniela(quinielaId, predicciones) {
    const partidos = db.prepare("SELECT * FROM quiniela_partidos WHERE quiniela_id = ? ORDER BY orden ASC").all(quinielaId);
    const pred = String(predicciones || "").toUpperCase();
    const lineas = partidos.map((p, i) => {
        const salio = p.resultado_final ? SIGNO[p.resultado_final] : null;
        return {
            orden: p.orden,
            home: p.home_team,
            away: p.away_team,
            pick: pred[i] || "-",
            salio,
            acierto: salio ? pred[i] === salio : null,
        };
    });
    return {
        lineas,
        aciertos: lineas.filter((l) => l.acierto).length,
        jugados: lineas.filter((l) => l.salio).length,
        total: lineas.length,
    };
}

// Una quiniela se devolvió si caducó sin resultados o si nadie llegó al mínimo de aciertos (entonces
// nadie tiene premio y cada uno recuperó lo suyo, aunque su `premio` se guarde como 0).
const REEMBOLSADA = `(q.estado = 'caducada' OR (q.estado = 'cerrada' AND NOT EXISTS (
    SELECT 1 FROM quiniela_apuestas x WHERE x.quiniela_id = q.id AND x.premio > 0)))`;

/** Quinielas en las que ha jugado. `abiertas`: las que aún no se han liquidado; si no, las cerradas. */
function quinielasDe(userId, { abiertas = true, limite = 5 } = {}) {
    return db
        .prepare(
            `SELECT qa.*, q.jornada, q.deporte, q.estado, ${REEMBOLSADA} AS reembolsada
             FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id
             WHERE qa.user_id = ? AND q.estado ${abiertas ? "= 'abierta'" : "!= 'abierta'"}
             ORDER BY q.id DESC LIMIT ?`,
        )
        .all(userId, limite)
        .map((r) => ({ ...r, reembolsada: Boolean(r.reembolsada), detalle: detalleQuiniela(r.quiniela_id, r.predicciones) }));
}

/** Su apuesta en una quiniela concreta (o null). */
function quinielaDe(userId, quinielaId) {
    const r = db.prepare("SELECT * FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?").get(quinielaId, userId);
    return r ? { ...r, detalle: detalleQuiniela(quinielaId, r.predicciones) } : null;
}

/**
 * Estadísticas de apuestas: partidos y quinielas por separado. Lo apostado y el beneficio solo cuentan
 * lo ya resuelto; lo pendiente va en `enJuego`. Una quiniela devuelta cuenta como recuperada.
 */
function estadisticas(userId) {
    const partidos = db
        .prepare(
            `SELECT COUNT(*) AS total,
                SUM(CASE WHEN p.estado = 'finalizado' AND a.premio > 0 THEN 1 ELSE 0 END) AS ganadas,
                SUM(CASE WHEN p.estado = 'finalizado' AND a.premio = 0 THEN 1 ELSE 0 END) AS perdidas,
                SUM(CASE WHEN p.estado = 'abierto' THEN 1 ELSE 0 END) AS pendientes,
                -- Las liquidadas antes de guardar el premio (premio NULL) no se sabe si se ganaron.
                COALESCE(SUM(CASE WHEN p.estado = 'finalizado' AND a.premio IS NOT NULL THEN a.cantidad ELSE 0 END), 0) AS apostado,
                COALESCE(SUM(CASE WHEN p.estado = 'finalizado' THEN COALESCE(a.premio, 0) ELSE 0 END), 0) AS ganado,
                COALESCE(SUM(CASE WHEN p.estado = 'abierto' THEN a.cantidad ELSE 0 END), 0) AS enJuego
             FROM apuestas_usuario a JOIN apuestas_partidos p ON a.match_id = p.match_id
             WHERE a.user_id = ?`,
        )
        .get(userId);
    const quinielas = db
        .prepare(
            `SELECT COUNT(*) AS total,
                SUM(CASE WHEN q.estado = 'cerrada' AND qa.premio > 0 THEN 1 ELSE 0 END) AS ganadas,
                SUM(CASE WHEN q.estado = 'abierta' THEN 1 ELSE 0 END) AS pendientes,
                COALESCE(SUM(CASE WHEN q.estado != 'abierta' THEN qa.cantidad ELSE 0 END), 0) AS apostado,
                COALESCE(SUM(CASE WHEN q.estado = 'abierta' THEN 0 WHEN ${REEMBOLSADA} THEN qa.cantidad ELSE qa.premio END), 0) AS ganado,
                COALESCE(SUM(CASE WHEN q.estado = 'abierta' THEN qa.cantidad ELSE 0 END), 0) AS enJuego
             FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id
             WHERE qa.user_id = ?`,
        )
        .get(userId);
    const limpiar = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v || 0)]));
    return { partidos: limpiar(partidos), quinielas: limpiar(quinielas) };
}

function ultimasCasino(userId, n = 5) {
    return db.prepare("SELECT juego, resultado, apuesta FROM casino WHERE userId = ? ORDER BY fecha DESC LIMIT ?").all(userId, n);
}

// El mes de una fecha en hora de Madrid ("2026-10"), y su nombre ("octubre").
const ZONA = "Europe/Madrid";
const formatoMes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" });
const formatoNombreMes = new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, month: "long" });
const mesDe = (fecha) => formatoMes.format(new Date(fecha)).slice(0, 7);

/**
 * Lo máximo que se puede cobrar de las apuestas a un partido: el mejor de los marcadores finales posibles (1X2, marcador
 * exacto, goles y hándicap a la vez; ver systems/apuestas/mercados.maximoPorMarcador).
 */
function maximoDelPartido(apuestas) {
    return mercados.maximoPorMarcador(apuestas);
}

/**
 * La cartera de apuestas (F-AP-04): lo que tiene en juego ahora, lo máximo que puede cobrar de sus partidos pendientes
 * (de cada partido, el mejor resultado posible: maximoDelPartido) y el beneficio de lo resuelto este mes en hora de
 * Madrid (partidos por el día del partido, quinielas por el día en que se cerraron). La quiniela no suma al posible
 * premio: depende del bote y de cuántos acierten.
 */
function cartera(userId, ahora = Date.now()) {
    const pendientes = db
        .prepare(
            `SELECT a.match_id, a.eleccion, a.cantidad, a.cuota FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.user_id = ? AND p.estado = 'abierto'`,
        )
        .all(userId);
    const porPartido = new Map();
    for (const a of pendientes) porPartido.set(a.match_id, [...(porPartido.get(a.match_id) || []), a]);
    const premioPorPartido = new Map([...porPartido].map(([matchId, apuestas]) => [matchId, maximoDelPartido(apuestas)]));
    const quinielas = db
        .prepare(
            `SELECT COUNT(*) AS n, COALESCE(SUM(qa.cantidad), 0) AS cantidad FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id
             WHERE qa.user_id = ? AND q.estado = 'abierta'`,
        )
        .get(userId);

    // Lo de este mes; con un margen de días para no perder nada por la diferencia horaria, luego se filtra por el mes en Madrid.
    const mes = mesDe(ahora);
    const desde = new Date(ahora - 32 * 86400 * 1000).toISOString();
    const partidosMes = db
        .prepare(
            `SELECT a.cantidad, a.premio, p.start_time AS fecha FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.user_id = ? AND p.estado = 'finalizado' AND a.premio IS NOT NULL AND p.start_time >= ?`,
        )
        .all(userId, desde)
        .filter((r) => mesDe(r.fecha) === mes);
    const quinielasMes = db
        .prepare(
            `SELECT qa.cantidad, qa.premio, q.cerrada_en AS fecha, ${REEMBOLSADA} AS reembolsada
             FROM quiniela_apuestas qa JOIN quinielas q ON q.id = qa.quiniela_id
             WHERE qa.user_id = ? AND q.estado != 'abierta' AND q.cerrada_en >= ?`,
        )
        .all(userId, desde)
        .filter((r) => mesDe(r.fecha) === mes);
    const beneficioMes =
        partidosMes.reduce((s, r) => s + r.premio - r.cantidad, 0) +
        quinielasMes.reduce((s, r) => s + (r.reembolsada ? r.cantidad : r.premio) - r.cantidad, 0);

    return {
        enJuego: pendientes.reduce((s, a) => s + a.cantidad, 0) + quinielas.cantidad,
        partidos: premioPorPartido.size,
        quinielas: quinielas.n,
        posiblePremio: [...premioPorPartido.values()].reduce((s, n) => s + n, 0),
        beneficioMes,
        resueltasMes: partidosMes.length + quinielasMes.length,
        mes: formatoNombreMes.format(new Date(ahora)),
    };
}

module.exports = { SIGNO, partidosDe, detalleQuiniela, quinielasDe, quinielaDe, estadisticas, ultimasCasino, cartera, maximoDelPartido };
