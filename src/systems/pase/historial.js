// 🕰️ Historial de temporadas del pase (#300): al cambiar de temporada se guarda, una sola vez por servidor, un resumen de la que acaba de
// cerrar (cuánta gente participó, el top, el nivel más alto, y cuántas recompensas se cobraron y cuántas monedas fueron). Las temporadas
// pasadas se consultan en /pase → 🕰️ Historial sin tocar la actual. Se cierran al pasar un cron cada hora (y al abrir el historial).
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { monedasDelNivel } = require("./constantes");
const { curvaDe } = require("./ajustes");
const { nivelDe } = require("./niveles");
const { temporadaDe } = require("./pase");

const log = createLogger("Pase");
const TOP = 10;

/** Calcula el resumen de una temporada de un servidor con lo que hay en pase_progreso y pase_recompensas. */
function calcularResumen(guildId, temporada) {
    const curva = curvaDe(guildId);
    const filas = db
        .prepare("SELECT userId, xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND xp > 0 ORDER BY xp DESC, userId")
        .all(guildId, temporada)
        .map((f) => ({ ...f, nivel: nivelDe(f.xp, curva) }));
    const cobrados = db.prepare("SELECT nivel FROM pase_recompensas WHERE guildId = ? AND temporada = ?").all(guildId, temporada);
    return {
        participantes: filas.length,
        xp_total: filas.reduce((s, f) => s + f.xp, 0),
        nivel_max: filas.reduce((m, f) => Math.max(m, f.nivel), 0),
        reclamados: cobrados.length,
        monedas: cobrados.reduce((s, c) => s + monedasDelNivel(c.nivel), 0),
        top: filas.slice(0, TOP),
    };
}

/** Guarda el resumen de una temporada ya cerrada. @returns {boolean} si lo guardó ahora (false si ya estaba guardado: una sola vez) */
function guardarResumen(guildId, temporada, ahora = Date.now()) {
    const r = calcularResumen(guildId, temporada);
    return (
        db
            .prepare(
                `INSERT OR IGNORE INTO pase_temporadas (guildId, temporada, cerrada_en, participantes, xp_total, nivel_max, reclamados, monedas, top)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(guildId, temporada, ahora, r.participantes, r.xp_total, r.nivel_max, r.reclamados, r.monedas, JSON.stringify(r.top))
            .changes === 1
    );
}

/**
 * Guarda el resumen de las temporadas que ya han acabado y aún no lo tienen (las de cualquier servidor con XP en ellas). Cada una, una sola vez.
 * @returns {number} cuántas ha guardado
 */
function cerrarPasadas(ahora = Date.now()) {
    const actual = temporadaDe(ahora).numero;
    const pendientes = db
        .prepare(
            `SELECT DISTINCT guildId, temporada FROM pase_progreso p WHERE temporada < ? AND xp > 0
             AND NOT EXISTS (SELECT 1 FROM pase_temporadas t WHERE t.guildId = p.guildId AND t.temporada = p.temporada)`,
        )
        .all(actual);
    let guardadas = 0;
    for (const { guildId, temporada } of pendientes) if (guardarResumen(guildId, temporada, ahora)) guardadas++;
    if (guardadas) log.info(`Historial del pase: ${guardadas} temporadas guardadas`);
    return guardadas;
}

const leer = (f) => ({ ...f, top: JSON.parse(f.top) });

/** Las temporadas pasadas de un servidor con resumen, la más reciente primero. */
function temporadasPasadas(guildId, limite = 25) {
    return db
        .prepare("SELECT * FROM pase_temporadas WHERE guildId = ? ORDER BY temporada DESC LIMIT ?")
        .all(String(guildId), limite)
        .map(leer);
}

/** El resumen de una temporada pasada, o null. */
const resumenDe = (guildId, temporada) => {
    const f = db.prepare("SELECT * FROM pase_temporadas WHERE guildId = ? AND temporada = ?").get(String(guildId), Number(temporada));
    return f ? leer(f) : null;
};

module.exports = { calcularResumen, guardarResumen, cerrarPasadas, temporadasPasadas, resumenDe };
