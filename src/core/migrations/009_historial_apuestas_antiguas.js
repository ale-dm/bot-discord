// Hasta el 2026-09-24, al apostar en /apuestas o en la quiniela no se apuntaba en el historial lo
// apostado (solo el premio al ganar), así que el "ganado/perdido" de /nivel contaba el premio entero
// como ganancia. Aquí se añaden los apuntes que faltan, con la cantidad en negativo como los nuevos.
//
// - Quiniela: quiniela_apuestas.creada_en es la fecha exacta, y el apunte nuevo se escribe en el
//   mismo momento, así que falta el de cada apuesta que no tenga uno de su cantidad a <1 min.
// - Partidos: apuestas_usuario no guarda la fecha de la apuesta. Se cuentan por persona, partido y
//   cantidad las apuestas y los apuntes "Apuesta: Local vs Visitante" que ya hay, y se añaden los que
//   falten con la fecha de inicio del partido (se apuesta antes de que empiece).
const { hasColumn } = require("./index");

function up(db, { log } = {}) {
    const insertar = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)");

    const quinielas = db
        .prepare(
            `
        SELECT a.user_id, a.cantidad, a.creada_en FROM quiniela_apuestas a
        WHERE a.cantidad > 0 AND NOT EXISTS (
            SELECT 1 FROM historial h
            WHERE h.userId = a.user_id AND h.descripcion = 'Quiniela: apuesta' AND h.cantidad = -a.cantidad
              AND ABS(julianday(h.fecha) - julianday(a.creada_en)) < 1.0 / 1440
        )
    `,
        )
        .all();
    for (const a of quinielas) insertar.run(a.user_id, a.creada_en, "Quiniela: apuesta", -a.cantidad);

    // Una BD muy antigua puede no tener aún los equipos en apuestas_partidos: entonces no hay nada que rellenar.
    const conEquipos = ["home_team", "away_team", "start_time"].every((c) => hasColumn(db, "apuestas_partidos", c));
    const grupos = !conEquipos
        ? []
        : db
              .prepare(
                  `
        SELECT a.user_id, a.cantidad, p.home_team, p.away_team, MIN(p.start_time) AS fecha, COUNT(*) AS apuestas,
            (SELECT COUNT(*) FROM historial h
             WHERE h.userId = a.user_id AND h.cantidad = -a.cantidad
               AND h.descripcion = 'Apuesta: ' || p.home_team || ' vs ' || p.away_team) AS apuntes
        FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
        WHERE a.cantidad > 0
        GROUP BY a.user_id, a.match_id, a.cantidad
    `,
              )
              .all();
    let partidos = 0;
    for (const g of grupos) {
        for (let i = g.apuntes; i < g.apuestas; i++) {
            insertar.run(g.user_id, g.fecha, `Apuesta: ${g.home_team} vs ${g.away_team}`, -g.cantidad);
            partidos++;
        }
    }
    if (quinielas.length || partidos)
        log?.info(`Añadidos al historial ${partidos} apuestas a partidos y ${quinielas.length} de quiniela antiguas`);
}

module.exports = { up };
