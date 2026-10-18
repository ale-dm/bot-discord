// ⭐ Partido destacado del día (F-AP-07): cada día, desde las 10:00 (hora de Madrid), se publica en el canal de resultados
// de las apuestas el partido grande de la jornada con sus cuotas y los botones para apostar. Sale de los partidos ya
// guardados (apuestas_partidos, que se rellena al consultar las cuotas): no gasta créditos de la Odds API.
//
// "Partido grande": de los de hoy que aún no han empezado, el que más apuestas tiene ya; a igualdad, el más igualado
// (cuotas de local y visitante más parecidas, que suele ser un partido entre dos buenos equipos) y, si no, el primero.
// El envío (embed y botones) vive en src/discord/envios/destacado (#472): aquí solo se elige el partido.
const db = require("../../core/db");

/** Desde esta hora (Madrid) se publica. */
const HORA = 10;

const { momentoMadrid: momento } = require("../../core/zonaMadrid");

/** El partido destacado de hoy (con `apuestas`, cuántas tiene ya), o null si hoy no queda ninguno con cuotas. */
function elegir(ahora = Date.now()) {
    const { dia } = momento(ahora);
    // Los próximos dos días en SQL (las horas son texto ISO en UTC) y el día exacto, en hora de Madrid.
    const candidatos = db
        .prepare(
            `SELECT p.*, (SELECT COUNT(*) FROM apuestas_usuario a WHERE a.match_id = p.match_id) AS apuestas
             FROM apuestas_partidos p
             WHERE p.estado = 'abierto' AND p.start_time > ? AND p.start_time < ?
               AND p.cuota_home IS NOT NULL AND p.cuota_draw IS NOT NULL AND p.cuota_away IS NOT NULL`,
        )
        .all(new Date(ahora).toISOString(), new Date(ahora + 2 * 86400 * 1000).toISOString())
        .filter((p) => momento(p.start_time).dia === dia);
    const igualdad = (p) => Math.abs(p.cuota_home - p.cuota_away);
    candidatos.sort(
        (a, b) => b.apuestas - a.apuestas || igualdad(a) - igualdad(b) || a.start_time.localeCompare(b.start_time) || a.id - b.id,
    );
    return candidatos[0] || null;
}

module.exports = { HORA, momento, elegir };
