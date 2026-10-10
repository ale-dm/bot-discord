// Caducidad de los partidos sin resultado y el mínimo de aciertos de una quiniela.

const db = require("../../../core/db");
const dinero = require("../../dinero");
const retos = require("../../retos");
const combinadas = require("../combinadas");
const { logInfo, logWarn } = require("../../../core/logger");
const { DIAS_RESULTADOS } = require("../../../services/oddsApi");

// Un partido de fútbol dura ~2h desde el inicio: antes de eso no merece la pena gastar
// cuota de la Odds API preguntando por su resultado (lo usa la liquidación automática).
const AUTO_MIN_HORAS_DESDE_INICIO = 2;

if (!process.env.ODDS_API_KEY) {
    logWarn("[PAGARAPUESTAS] ODDS_API_KEY no configurada en .env: no se podrán liquidar apuestas.");
}

/**
 * Partidos y quinielas que ya no se pueden resolver (empezaron hace más de DIAS_RESULTADOS días
 * y siguen sin resultado): se marcan como caducados y se devuelve lo apostado. Sin esto se
 * quedaban abiertos para siempre, con el dinero retenido, y el cron seguía preguntando por
 * ellos a la API cada hora (gastando cuota).
 */
function caducarSinResultado(limite, resumen) {
    const ahoraIso = new Date().toISOString();
    const reembolsar = (userId, cantidad, descripcion) => {
        dinero.pagar(userId, cantidad);
        dinero.apuntar(userId, "apuestas", descripcion, cantidad);
        resumen.reembolsos++;
        resumen.pagos.push({ userId, premio: cantidad, descripcion, reembolso: true });
        logInfo(`[PAGARAPUESTAS] Reembolsadas ${cantidad} monedas a ${userId}: ${descripcion}`);
    };

    const partidos = db
        .prepare(
            `
        SELECT * FROM apuestas_partidos WHERE estado = 'abierto' AND start_time < ?
    `,
        )
        .all(limite);
    const quinielas = db
        .prepare(
            `
        SELECT q.* FROM quinielas q
        WHERE q.estado = 'abierta'
          AND EXISTS (SELECT 1 FROM quiniela_partidos p WHERE p.quiniela_id = q.id AND p.resultado_final IS NULL AND p.start_time < ?)
    `,
        )
        .all(limite);
    if (!partidos.length && !quinielas.length) return;

    db.transaction(() => {
        for (const p of partidos) {
            const apuestas = db.prepare("SELECT * FROM apuestas_usuario WHERE match_id = ? AND pagado = 0").all(p.match_id);
            for (const ap of apuestas) {
                reembolsar(ap.user_id, ap.cantidad, `Reembolso: ${p.home_team} vs ${p.away_team} sin resultado disponible`);
                // premio = cantidad: se le devuelve lo apostado.
                db.prepare("UPDATE apuestas_usuario SET pagado = 1, premio = ? WHERE id = ?").run(ap.cantidad, ap.id);
            }
            // Las combinadas con una pata en ese partido se devuelven enteras.
            combinadas.caducarPartido(p.match_id, (userId, cantidad, descripcion) => reembolsar(userId, cantidad, descripcion));
            // Los retos 1 contra 1 a ese partido, igual: cada uno recupera lo suyo.
            const devueltos = retos.devolverPorPartido(p.match_id, "el partido se quedó sin resultado");
            resumen.reembolsos += devueltos.pagos.length;
            resumen.pagos.push(...devueltos.pagos);
            resumen.retosCerrados.push(...devueltos.cerrados.map((r) => r.id));
            db.prepare("UPDATE apuestas_partidos SET estado = 'caducado' WHERE id = ?").run(p.id);
        }
        for (const q of quinielas) {
            const apuestas = db.prepare("SELECT * FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0").all(q.id);
            for (const ap of apuestas) {
                reembolsar(ap.user_id, ap.cantidad, `Reembolso: quiniela ${q.jornada} sin todos los resultados`);
                db.prepare("UPDATE quiniela_apuestas SET pagado = 1, premio = 0 WHERE id = ?").run(ap.id);
            }
            db.prepare("UPDATE quinielas SET estado = 'caducada', cerrada_en = ? WHERE id = ?").run(ahoraIso, q.id);
        }
    })();
    resumen.caducados += partidos.length + quinielas.length;
    logInfo(
        `[PAGARAPUESTAS] Caducados ${partidos.length} partidos y ${quinielas.length} quinielas sin resultado (empezaron hace más de ${DIAS_RESULTADOS} días); ${resumen.reembolsos} apuestas reembolsadas`,
    );
}

/** Aciertos necesarios para cobrar una quiniela: la mitad de los partidos, redondeando hacia arriba. */
function minimoAciertosQuiniela(numPartidos) {
    return Math.ceil(numPartidos / 2);
}

module.exports = { AUTO_MIN_HORAS_DESDE_INICIO, caducarSinResultado, minimoAciertosQuiniela };
