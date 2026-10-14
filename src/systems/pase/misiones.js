// Las misiones del día del pase: cuáles son hoy (3 de las 7, rotando), avanzarlas con los eventos de su categoría y, al completarlas, dar su
// XP y mirar si ya están las tres (día perfecto, #334, y racha, #335).
const db = require("../../core/db");
const { DIA_MS, ORIGEN, MISIONES, MISIONES_DIA, MISION_XP } = require("./constantes");
const { sumarXp } = require("./xp");
const { comprobarDiaPerfecto } = require("./rachas");

/** Las 3 misiones de hoy: rotan con el día, así que son las mismas para todos. */
function misionesDeHoy(ahora = Date.now()) {
    const indice = Math.floor((ahora - ORIGEN) / DIA_MS);
    return Array.from({ length: MISIONES_DIA }, (_, k) => MISIONES[(indice + k) % MISIONES.length]);
}

/** Suma `cantidad` a una misión de hoy; al llegar a la meta da su XP (una vez) y comprueba el día perfecto. */
function avanzarMision(guildId, temporada, userId, dia, mision, cantidad, ahora) {
    db.prepare(
        `INSERT INTO pase_misiones (guildId, temporada, userId, dia, mision, progreso) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId, temporada, userId, dia, mision) DO UPDATE SET progreso = progreso + excluded.progreso`,
    ).run(guildId, temporada, userId, dia, mision.id, cantidad);
    const fila = db
        .prepare(
            "SELECT progreso, completada FROM pase_misiones WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
        )
        .get(guildId, temporada, userId, dia, mision.id);
    if (fila.completada || fila.progreso < mision.meta) return;
    db.prepare("UPDATE pase_misiones SET completada = 1 WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?").run(
        guildId,
        temporada,
        userId,
        dia,
        mision.id,
    );
    sumarXp(guildId, temporada, userId, MISION_XP);
    comprobarDiaPerfecto(guildId, temporada, userId, dia, misionesDeHoy(ahora));
}

module.exports = { misionesDeHoy, avanzarMision };
