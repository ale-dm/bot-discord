// Revisión periódica (cron cada 5 min): cierra lo que se ha quedado colgado.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { ABANDONO_MS, PORRA_DIAS } = require("./constantes");
const { obtener, guardarDatos } = require("./persistencia");
const { devolver } = require("./cobros");
const { resolverBlackjack } = require("./duelos");
const { recordatoriosPendientes } = require("./avisos");

const log = createLogger("Retos");

// ─── Revisión periódica ──────────────────────────────────────────────────────

/**
 * Lo que se ha quedado colgado (cron cada 5 min): retos que nadie aceptó a tiempo (se devuelven), duelos
 * abandonados (en el blackjack se planta a quien no terminó y se resuelve; en piedra-papel-tijera se devuelve) y
 * porras sin resolver en PORRA_DIAS días (se devuelven). Además: las porras con cierre automático que ya han llegado a su
 * fecha pasan a cerradas (#448; van en `modificados`, para repintar su mensaje) y los retos pendientes que están a la mitad
 * de su plazo se devuelven en `recordatorios` (#439), cada uno una sola vez, para avisar a su rival.
 * @returns {{ cerrados: object[], pagos: object[], modificados: object[], recordatorios: object[] }}
 */
function revisar(ahora = Date.now()) {
    const cerrados = [];
    const pagos = [];
    const modificados = [];
    const apuntar = (hecho) => {
        if (!hecho) return;
        cerrados.push(hecho.reto);
        pagos.push(...hecho.pagos);
    };
    // También los de un partido que ya ha empezado aunque no hayan caducado (la hora del partido puede cambiar).
    const sinAceptar = db
        .prepare(
            `SELECT id FROM retos WHERE estado = 'pendiente' AND expira_en <= ?
             UNION
             SELECT r.id FROM retos r JOIN apuestas_partidos p ON p.match_id = r.match_id
             WHERE r.tipo = 'partido' AND r.estado = 'pendiente' AND p.start_time <= ?`,
        )
        .all(ahora, new Date(ahora).toISOString());
    for (const r of sinAceptar) apuntar(devolver(r.id, "nadie lo aceptó a tiempo"));
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'duelo' AND estado = 'en_juego' AND actualizado_en <= ?")
        .all(ahora - ABANDONO_MS)) {
        const reto = obtener(r.id);
        if (reto.juego === "blackjack" && reto.datos) {
            for (const id of Object.keys(reto.datos.plantados)) reto.datos.plantados[id] = true;
            guardarDatos(reto.id, reto.datos);
            apuntar(resolverBlackjack(obtener(reto.id)));
        } else {
            apuntar(devolver(reto.id, "abandonado: no se jugó a tiempo"));
        }
    }
    for (const r of db
        .prepare("SELECT id FROM retos WHERE tipo = 'porra' AND estado IN ('abierta', 'cerrada') AND expira_en <= ?")
        .all(ahora)) {
        apuntar(devolver(r.id, `sin resolver en ${PORRA_DIAS} días`));
    }
    for (const id of db
        .prepare("SELECT id FROM retos WHERE tipo = 'porra' AND estado = 'abierta' AND cierra_en IS NOT NULL AND cierra_en <= ?")
        .pluck()
        .all(ahora)) {
        const r = db.prepare("UPDATE retos SET estado = 'cerrada', actualizado_en = ? WHERE id = ? AND estado = 'abierta'").run(ahora, id);
        if (r.changes === 1) modificados.push(obtener(id));
    }
    const recordatorios = recordatoriosPendientes(ahora);
    if (cerrados.length || modificados.length) {
        log.info(`Revisión: ${cerrados.length} retos cerrados (${pagos.length} pagos), ${modificados.length} porras cerradas por su fecha`);
    }
    return { cerrados, pagos, modificados, recordatorios };
}

module.exports = { revisar };
