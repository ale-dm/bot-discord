// 🔥 Día perfecto y racha del pase (#334, #335): completar las tres misiones del día da un bonus de XP, una vez por día; los días perfectos
// seguidos (calendario de Madrid) forman una racha que, al llegar a ciertos días (RACHA_HITOS), da XP extra una sola vez por racha.
const db = require("../../core/db");
const { sumarDias } = require("../../core/zonaMadrid");
const { BONUS_DIA_PERFECTO, RACHA_HITOS } = require("./constantes");
const { sumarXp } = require("./xp");

/** Los días perfectos de alguien, del más reciente al más antiguo. */
const diasPerfectos = (guildId, userId) =>
    db
        .prepare("SELECT dia FROM pase_dias_perfectos WHERE guildId = ? AND userId = ? ORDER BY dia DESC")
        .all(String(guildId), String(userId))
        .map((f) => f.dia);

/**
 * La racha de días perfectos que acaba en `dia` (AAAA-MM-DD): cuántos días seguidos hasta él. Si `dia` no es perfecto, 0.
 * @returns {number}
 */
function rachaHasta(dias, dia) {
    const set = new Set(dias);
    let racha = 0;
    for (let d = dia; set.has(d); d = sumarDias(d, -1)) racha++;
    return racha;
}

/**
 * La racha de alguien ahora: los días perfectos seguidos hasta hoy; si hoy aún no lo es, hasta ayer (la racha sigue viva hasta que acabe
 * el día). `hoyPerfecto`: si ya ha completado las tres de hoy.
 */
function rachaDe(guildId, userId, hoy) {
    const dias = diasPerfectos(guildId, userId);
    const hoyPerfecto = dias.includes(hoy);
    return { dias: rachaHasta(dias, hoyPerfecto ? hoy : sumarDias(hoy, -1)), hoyPerfecto };
}

/** Los hitos de la racha que acaba en `dia` y aún no se han premiado en esa racha, con su XP (se dan al llamar). */
function premiarRacha(guildId, temporada, userId, dia) {
    const racha = rachaHasta(diasPerfectos(guildId, userId), dia);
    const inicio = sumarDias(dia, -(racha - 1));
    const premiar = db.prepare("INSERT OR IGNORE INTO pase_racha_premios (guildId, userId, inicio, hito) VALUES (?, ?, ?, ?)");
    for (const hito of RACHA_HITOS) {
        if (racha >= hito.dias && premiar.run(guildId, userId, inicio, hito.dias).changes === 1)
            sumarXp(guildId, temporada, userId, hito.xp);
    }
}

/**
 * Se llama al completar una misión: si ya están las tres de hoy y es la primera vez ese día, da el bonus y mira si toca premio de racha.
 * @param {{ id: string }[]} misionesDeHoy las tres misiones del día
 */
function comprobarDiaPerfecto(guildId, temporada, userId, dia, misionesDeHoy) {
    const completas = misionesDeHoy.every(
        (m) =>
            db
                .prepare(
                    "SELECT completada FROM pase_misiones WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
                )
                .get(guildId, temporada, userId, dia, m.id)?.completada,
    );
    if (!completas) return;
    const nuevo = db
        .prepare("INSERT OR IGNORE INTO pase_dias_perfectos (guildId, userId, dia, temporada) VALUES (?, ?, ?, ?)")
        .run(guildId, userId, dia, temporada);
    if (nuevo.changes !== 1) return;
    sumarXp(guildId, temporada, userId, BONUS_DIA_PERFECTO);
    premiarRacha(guildId, temporada, userId, dia);
}

module.exports = { rachaDe, rachaHasta, comprobarDiaPerfecto };
