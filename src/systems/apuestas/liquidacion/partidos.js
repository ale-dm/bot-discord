// Liquidar los partidos sueltos del corte: cerrar cada uno con resultado y pagar o cobrar.

const db = require("../../../core/db");
const dinero = require("../../dinero");
const retos = require("../../retos");
const mercados = require("../mercados");
const combinadas = require("../combinadas");
const pase = require("../../pase/pase");
const { logInfo, logDebug } = require("../../../core/logger");
const { deporteValido, resultadoDeScore } = require("../../../services/oddsApi");

/**
 * Cierra cada partido terminado del corte con su resultado, y paga o cobra sus apuestas y sus retos. Lo llama
 * liquidarApuestas (orquesta.js).
 */
async function liquidarPartidosSueltos({ corte, limite, resumen, scoresDe, origen }) {
    const partidos = db
        .prepare(
            `
        SELECT id, match_id, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away, estado, deporte, resultado, cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea FROM apuestas_partidos
        WHERE estado = 'abierto' AND start_time < ? AND start_time >= ?
          -- Solo los que tienen apuestas, patas de combinadas o retos pendientes: preguntar por el resto gasta cuota para nada.
          AND (EXISTS (SELECT 1 FROM apuestas_usuario a WHERE a.match_id = apuestas_partidos.match_id AND a.pagado = 0)
               OR EXISTS (SELECT 1 FROM combinada_patas pa JOIN combinadas c ON c.id = pa.combinada_id
                          WHERE pa.match_id = apuestas_partidos.match_id AND pa.resultado = 'pendiente' AND c.estado = 'abierta')
               OR EXISTS (SELECT 1 FROM retos r WHERE r.match_id = apuestas_partidos.match_id AND r.estado IN ('pendiente', 'en_juego')))
    `,
        )
        .all(corte, limite);
    (partidos.length ? logInfo : logDebug)(`[PAGARAPUESTAS] (${origen}) ${partidos.length} partidos pendientes de cierre`);

    const cerrarPartido = db.transaction(cerrarPartidoEnTransaccion);

    for (const partido of partidos) {
        const deporteKey = deporteValido(partido.deporte);
        const scores = await scoresDe(deporteKey);
        if (!scores) continue;

        const r = resultadoDeScore(scores.find((s) => s.id === partido.match_id));
        if (!r) {
            logDebug(`[PAGARAPUESTAS] Partido ${partido.home_team} vs ${partido.away_team} aún sin resultado final`);
            continue;
        }
        logInfo(`[PAGARAPUESTAS] ${partido.home_team} ${r.home.score}-${r.away.score} ${partido.away_team} -> ${r.resultado}`);
        const marcador = `${r.home.score}-${r.away.score}`;
        const cierre = cerrarPartido(partido, r.resultado, marcador, resumen);
        // Un partido con solo retos no sale como "nadie acertó (0 apuestas)": sus retos van aparte.
        if (cierre.apostantes) {
            resumen.partidos.push({ deporte: deporteKey, home: partido.home_team, away: partido.away_team, marcador, ...cierre });
        }
        resumen.partidosProcesados[deporteKey] = (resumen.partidosProcesados[deporteKey] || 0) + 1;
    }
}

// Cierra un partido dentro de una transacción: guarda su resultado, liquida sus apuestas, sus combinadas y sus retos.
function cerrarPartidoEnTransaccion(partido, resultado, marcador, resumen) {
    db.prepare("UPDATE apuestas_partidos SET estado = 'finalizado', resultado = ? WHERE match_id = ?").run(resultado, partido.match_id);
    const apuestas = db
        .prepare(
            `
            SELECT id, user_id, match_id, eleccion, cantidad, cuota, pagado, premio, recordado, linea FROM apuestas_usuario
            WHERE match_id = ? AND pagado = 0
        `,
        )
        .all(partido.match_id);
    const cierre = { apostantes: apuestas.length, ganadores: [], repartido: 0 };
    for (const ap of apuestas) liquidarApuesta(ap, partido, resultado, marcador, resumen, cierre);
    // Combinadas con una pata en este partido: una pata fallida pierde el boleto; con todas acertadas, se paga.
    resumen.pagos.push(...combinadas.resolverPartido(partido.match_id, resultado, marcador));
    anotarRetos(partido, resultado, marcador, resumen);
    return cierre;
}

// Paga o cobra una apuesta del partido, y la apunta en el resumen y en el cierre del partido.
function liquidarApuesta(ap, partido, resultado, marcador, resumen, cierre) {
    resumen.total++;
    // Las de marcador exacto (F-AP-10) aciertan con el marcador; las demás, con el resultado.
    const gana = mercados.acierta(ap.eleccion, resultado, marcador, ap.linea);
    pase.registrarEnTodos(ap.user_id, "apuesta");
    if (gana) {
        const premio = Math.round(ap.cantidad * ap.cuota);
        dinero.pagar(ap.user_id, premio);
        dinero.apuntar(ap.user_id, "apuestas", `Apuesta ganada: ${partido.home_team} vs ${partido.away_team}`, premio);
        cierre.ganadores.push(ap.user_id);
        cierre.repartido += premio;
        resumen.pagadas++;
        resumen.pagos.push({ userId: ap.user_id, premio, descripcion: `${partido.home_team} vs ${partido.away_team}` });
        logInfo(`[PAGARAPUESTAS] Pagado ${premio} monedas a usuario ${ap.user_id} (apostó ${ap.cantidad} con cuota ${ap.cuota})`);
    } else {
        resumen.fallidas++;
        logInfo(
            `[PAGARAPUESTAS] Apuesta perdida: usuario ${ap.user_id} perdió ${ap.cantidad} monedas (apostó ${ap.eleccion}, ganó ${resultado}, ${marcador})`,
        );
    }
    db.prepare("UPDATE apuestas_usuario SET pagado = 1, premio = ? WHERE id = ?").run(gana ? Math.round(ap.cantidad * ap.cuota) : 0, ap.id);
}

// Retos 1 contra 1 al partido: el ganador se lleva lo de los dos (los que nadie aceptó se devuelven).
function anotarRetos(partido, resultado, marcador, resumen) {
    const deRetos = retos.resolverPartido(partido.match_id, resultado, marcador);
    resumen.pagos.push(...deRetos.pagos);
    for (const r of deRetos.cerrados) {
        resumen.retosCerrados.push(r.id);
        const ganador = r.participantes.find((p) => p.premio > 0 && r.estado === "resuelto");
        if (ganador) {
            resumen.retos.push({
                creador: r.creador,
                rival: r.rival,
                ganador: ganador.userId,
                premio: ganador.premio,
                partido: r.resultado,
            });
        }
    }
}

module.exports = { liquidarPartidosSueltos };
