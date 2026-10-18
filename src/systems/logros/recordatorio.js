// 🔔 Recordatorio semanal de logros sin reclamar (#378): un DM a quien tiene logros completados sin reclamar, como mucho una
// vez cada 7 días por servidor. Cuenta lo mismo que /perfil → 🏅 Logros (sin las categorías desactivadas).
// El envío vive en src/discord/envios/logros (#472): aquí solo se decide a quién toca.
const db = require("../../core/db");
const achievements = require("../achievementsSystem");
const { ensureUser } = require("../xp/config");

// Un poco menos de 7 días: el cron semanal tarda unos segundos de más cada vez y no debe saltarse una semana.
const ESPERA_MS = 6.5 * 24 * 60 * 60 * 1000;

/** Personas que tienen logros sin reclamar y aún no se les ha recordado esta semana: [{ guildId, userId, claimable }]. */
function avisosPendientes(ahora = Date.now()) {
    const filas = db
        .prepare("SELECT DISTINCT guildId, userId FROM achievements_progress WHERE completedAt IS NOT NULL AND claimedAt IS NULL")
        .all();
    const pendientes = [];
    for (const { guildId, userId } of filas) {
        if (!achievements.categoriaActiva(guildId, "")) continue; // sin categoría: solo mira que los logros estén activados
        ensureUser(guildId, userId); // la fila donde se apunta cuándo se avisó
        const ultimo = db
            .prepare("SELECT ultimo_recordatorio_logros AS u FROM xp_users WHERE guildId = ? AND userId = ?")
            .get(guildId, userId)?.u;
        if (ultimo && ahora - Number(ultimo) < ESPERA_MS) continue;
        const { claimable } = achievements.getSummary(guildId, userId);
        if (claimable <= 0) continue;
        pendientes.push({ guildId, userId, claimable });
    }
    return pendientes;
}

/** Apunta que ya se le ha recordado (no se le vuelve a avisar hasta dentro de una semana). */
function marcarAviso(guildId, userId, ahora = Date.now()) {
    db.prepare("UPDATE xp_users SET ultimo_recordatorio_logros = ? WHERE guildId = ? AND userId = ?").run(ahora, guildId, userId);
}

module.exports = { avisosPendientes, marcarAviso, ESPERA_MS };
