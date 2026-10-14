// 🏆 Historial de campeones del ranking semanal de Plex (#389): cada semana publicada guarda quién quedó primero (una fila por semana y
// servidor: publicarla dos veces no la duplica). Una semana en la que nadie vio nada no tiene campeón. Solo se guarda desde ahora; las
// semanas anteriores a esta función no se reconstruyen.
const db = require("../core/db");

/** Guarda el campeón de una semana (`primero`: { discordUserId, plexUsername, segundos }). Sin él (nadie vio nada), no guarda nada. */
function guardar(guildId, semana, primero) {
    if (!primero || !(primero.segundos > 0)) return false;
    db.prepare(
        `INSERT INTO plex_ranking_campeones (guildId, semana, discordUserId, plexUsername, segundos) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guildId, semana) DO UPDATE SET discordUserId = excluded.discordUserId, plexUsername = excluded.plexUsername, segundos = excluded.segundos`,
    ).run(String(guildId), semana, String(primero.discordUserId), primero.plexUsername ?? null, Math.round(primero.segundos));
    return true;
}

/** Las últimas semanas con campeón, la más reciente primero: [{ semana, discordUserId, plexUsername, segundos }]. */
function ultimas(guildId, cuantas = 10) {
    return db
        .prepare(
            "SELECT semana, discordUserId, plexUsername, segundos FROM plex_ranking_campeones WHERE guildId = ? ORDER BY semana DESC LIMIT ?",
        )
        .all(String(guildId), cuantas);
}

/** Cuántas semanas ha ganado cada persona, de más a menos: [{ discordUserId, victorias }]. */
function victorias(guildId, limite = 10) {
    return db
        .prepare(
            `SELECT discordUserId, COUNT(*) AS victorias FROM plex_ranking_campeones WHERE guildId = ?
             GROUP BY discordUserId ORDER BY victorias DESC, MAX(semana) DESC LIMIT ?`,
        )
        .all(String(guildId), limite);
}

module.exports = { guardar, ultimas, victorias };
