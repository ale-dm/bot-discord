// Liquidar las quinielas abiertas: guardar los resultados conocidos, cerrar y pagar cada jornada.

const db = require("../../../core/db");
const dinero = require("../../dinero");
const { logInfo, logDebug } = require("../../../core/logger");
const { deporteValido, resultadoDeScore } = require("../../../services/oddsApi");
const { minimoAciertosQuiniela } = require("./caducidad");

// Quinielas abiertas: guarda los resultados que ya se conocen y cierra y paga las jornadas que han acabado.
async function liquidarQuinielas({ corte, resumen, scoresDe, origen }) {
    // Cada resultado se guarda en cuanto se conoce (quiniela_partidos.resultado_final): una
    // jornada dura de viernes a lunes, y cuando acaba el último partido el primero ya no está
    // en la ventana de la API. Antes solo se guardaban si estaban los 10 a la vez, y así una
    // jornada larga no se podía completar nunca.
    const quinielasAbiertas = db
        .prepare(`SELECT id, deporte, jornada, estado, creador_id, creada_en, cerrada_en FROM quinielas WHERE estado = 'abierta'`)
        .all();

    for (const q of quinielasAbiertas) {
        const deporteKey = deporteValido(q.deporte);
        let partidosQ = db
            .prepare(
                `
            SELECT id, quiniela_id, match_id, orden, home_team, away_team, start_time, resultado_final FROM quiniela_partidos WHERE quiniela_id = ? ORDER BY orden ASC
        `,
            )
            .all(q.id);
        if (!partidosQ.length) continue;

        // Una quiniela sin jugadores no se consulta (caducará sola sin nada que devolver).
        const tieneJugadores = !!db.prepare("SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0").get(q.id);
        const consultables = tieneJugadores ? partidosQ.filter((p) => !p.resultado_final && p.start_time < corte) : [];
        if (consultables.length) {
            const scores = await scoresDe(deporteKey);
            if (!scores) continue;
            for (const p of consultables) {
                const r = resultadoDeScore(scores.find((s) => s.id === p.match_id));
                if (r) db.prepare(`UPDATE quiniela_partidos SET resultado_final = ? WHERE id = ?`).run(r.resultado, p.id);
            }
            partidosQ = db
                .prepare(
                    `SELECT id, quiniela_id, match_id, orden, home_team, away_team, start_time, resultado_final FROM quiniela_partidos WHERE quiniela_id = ? ORDER BY orden ASC`,
                )
                .all(q.id);
        }
        if (partidosQ.some((p) => !p.resultado_final)) continue;

        const resultados = partidosQ.map((p) => ({ partidoId: p.id, resultado: p.resultado_final }));
        const apuestasQ = db
            .prepare(
                `
            SELECT id, quiniela_id, user_id, predicciones, cantidad, aciertos, premio, pagado, creada_en FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0
        `,
            )
            .all(q.id);

        const apuestasConAciertos = apuestasQ.map((ap) => {
            const pred = (ap.predicciones || "").toUpperCase();
            let aciertos = 0;
            resultados.forEach((r, i) => {
                const esperado = r.resultado === "home" ? "1" : r.resultado === "draw" ? "X" : "2";
                if (pred[i] === esperado) aciertos++;
            });
            return { ...ap, aciertos };
        });

        // Para cobrar hay que acertar al menos la mitad de los partidos (5 de 10). Si nadie llega,
        // se devuelve lo apostado: antes el 90 % se repartía entre los que más acertaran aunque
        // fallaran todo, y un jugador solo recuperaba el 90 % sin acertar nada.
        const minimo = minimoAciertosQuiniela(partidosQ.length);
        const maxAciertos = apuestasConAciertos.length ? Math.max(...apuestasConAciertos.map((a) => a.aciertos)) : 0;
        const hayGanadores = maxAciertos >= minimo;
        const ganadoras = hayGanadores ? apuestasConAciertos.filter((a) => a.aciertos === maxAciertos) : [];
        const bote = apuestasConAciertos.reduce((acc, a) => acc + a.cantidad, 0);
        const fondoPremios = Math.floor(bote * 0.9);
        const premioUnitario = ganadoras.length > 0 ? Math.floor(fondoPremios / ganadoras.length) : 0;

        db.transaction(() => {
            for (const a of apuestasConAciertos) {
                // Sin ganadores, "premio" es lo que se le devuelve (como en las caducadas).
                const premio = hayGanadores ? (a.aciertos === maxAciertos ? premioUnitario : 0) : a.cantidad;
                if (premio > 0) {
                    const descripcion = hayGanadores
                        ? `Quiniela ganada: ${q.jornada}`
                        : `Reembolso: quiniela ${q.jornada}, nadie llegó a ${minimo} aciertos`;
                    dinero.pagar(a.user_id, premio);
                    dinero.apuntar(a.user_id, "apuestas", descripcion, premio);
                    resumen.pagos.push(
                        hayGanadores
                            ? { userId: a.user_id, premio, descripcion: `Quiniela ${q.jornada}` }
                            : { userId: a.user_id, premio, descripcion, reembolso: true },
                    );
                }
                db.prepare(
                    `
                    UPDATE quiniela_apuestas
                    SET pagado = 1, aciertos = ?, premio = ?
                    WHERE id = ?
                `,
                ).run(a.aciertos, hayGanadores ? premio : 0, a.id);
            }
            db.prepare(`UPDATE quinielas SET estado = 'cerrada', cerrada_en = ? WHERE id = ?`).run(new Date().toISOString(), q.id);
        })();

        if (!hayGanadores) resumen.reembolsos += apuestasConAciertos.length;
        resumen.quinielasCerradas++;
        resumen.premiosQuiniela += premioUnitario * ganadoras.length;
        resumen.quinielas.push({
            deporte: deporteKey,
            jornada: q.jornada,
            jugadores: apuestasConAciertos.length,
            partidos: partidosQ.length,
            minimo,
            maxAciertos,
            ganadores: ganadoras.map((a) => a.user_id),
            premioUnitario,
        });
        logInfo(
            hayGanadores
                ? `[PAGARAPUESTAS] Quiniela cerrada ${q.id}: ${ganadoras.length} ganadores con ${maxAciertos} aciertos, premio unitario ${premioUnitario}`
                : `[PAGARAPUESTAS] Quiniela cerrada ${q.id}: nadie llegó a ${minimo} aciertos (máx. ${maxAciertos}), ${apuestasConAciertos.length} apuestas reembolsadas`,
        );
    }

    (resumen.total || resumen.quinielasCerradas || resumen.caducados ? logInfo : logDebug)(
        `[PAGARAPUESTAS] (${origen}) Completado: ${resumen.pagadas} ganadoras, ${resumen.fallidas} perdedoras, ${resumen.total} total, ${resumen.quinielasCerradas} quinielas, ${resumen.caducados} caducados`,
    );
}

module.exports = { liquidarQuinielas };
