// SQL de las cuotas de la Odds API: guardar los partidos con sus cuotas y ver qué competiciones tienen partidos en juego (#478).
// El cliente (services/oddsApi) pide y traduce lo que responde la API; aquí solo se guarda.
const db = require("../core/db");

// Si el partido ya existe y sigue abierto se actualizan cuotas y hora: antes era INSERT OR IGNORE
// y se quedaban para siempre las cuotas de la primera consulta y la hora original aunque el
// partido se aplazara (y con ella el cierre de apuestas). La cuota de cada apuesta ya hecha está
// guardada en apuestas_usuario, así que no le afecta.
const upsertPartido = () =>
    db.prepare(`
        INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, cuota_home, cuota_draw, cuota_away,
            cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea, cuotas_ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id) DO UPDATE SET
            start_time = excluded.start_time,
            cuota_home = COALESCE(excluded.cuota_home, cuota_home),
            cuota_draw = COALESCE(excluded.cuota_draw, cuota_draw),
            cuota_away = COALESCE(excluded.cuota_away, cuota_away),
            cuota_mas = COALESCE(excluded.cuota_mas, cuota_mas),
            cuota_menos = COALESCE(excluded.cuota_menos, cuota_menos),
            total_linea = COALESCE(excluded.total_linea, total_linea),
            cuota_casa = COALESCE(excluded.cuota_casa, cuota_casa),
            cuota_fuera = COALESCE(excluded.cuota_fuera, cuota_fuera),
            hcap_linea = COALESCE(excluded.hcap_linea, hcap_linea),
            cuotas_ts = excluded.cuotas_ts
        WHERE apuestas_partidos.estado = 'abierto'
    `);

/** Guarda los partidos ya traducidos: cada uno es { m: partido de la API, c: cuotas 1/X/2, x: cuotas de los demás mercados }. */
function guardarPartidos(deporteKey, partidos) {
    const stmt = upsertPartido();
    const ahora = Date.now(); // 💸 cuándo se guardaron estas cuotas: el cash-out (#529) no usa cuotas viejas
    // Lo mismo en las quinielas: con la hora antigua, un partido aplazado bloqueaba la quiniela
    // antes de tiempo (o la caducaba) aunque aún no se hubiera jugado.
    const horaQuiniela = db.prepare("UPDATE quiniela_partidos SET start_time = ? WHERE match_id = ? AND resultado_final IS NULL");
    db.transaction(() => {
        for (const { m, c, x } of partidos) {
            stmt.run(
                m.id,
                deporteKey,
                m.home_team,
                m.away_team,
                m.commence_time,
                c.home,
                c.draw,
                c.away,
                x.cuota_mas,
                x.cuota_menos,
                x.total_linea,
                x.cuota_casa,
                x.cuota_fuera,
                x.hcap_linea,
                ahora,
            );
            horaQuiniela.run(m.commence_time, m.id);
        }
    })();
}

/** Competiciones con algún partido abierto que ya ha empezado (y no hace más de lo que dura un partido). */
const deportesEnJuego = (isoAhora, isoDesde) =>
    db
        .prepare("SELECT DISTINCT deporte FROM apuestas_partidos WHERE estado = 'abierto' AND start_time <= ? AND start_time > ?")
        .all(isoAhora, isoDesde)
        .map((r) => r.deporte);

module.exports = { guardarPartidos, deportesEnJuego };
