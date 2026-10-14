// 🔔 Recordatorio semanal de logros sin reclamar (#378): un DM a quien tiene logros completados sin reclamar, como mucho una
// vez cada 7 días por servidor. Cuenta lo mismo que /perfil → 🏅 Logros (sin las categorías desactivadas).
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const achievements = require("../achievementsSystem");
const { enviarAviso } = require("../avisosDm");
const { ensureUser } = require("../xp/config");
const { embedPendientes } = require("../../discord/mensajes/logrosPendientes");

const log = createLogger("Logros");

// Un poco menos de 7 días: el cron semanal tarda unos segundos de más cada vez y no debe saltarse una semana.
const ESPERA_MS = 6.5 * 24 * 60 * 60 * 1000;

async function runLogrosPendientesJob(client) {
    const filas = db
        .prepare("SELECT DISTINCT guildId, userId FROM achievements_progress WHERE completedAt IS NOT NULL AND claimedAt IS NULL")
        .all();
    const ahora = Date.now();
    let enviados = 0;
    for (const { guildId, userId } of filas) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild || !achievements.categoriaActiva(guildId, "")) continue; // sin categoría: solo mira que los logros estén activados
        ensureUser(guildId, userId); // la fila donde se apunta cuándo se avisó
        const ultimo = db
            .prepare("SELECT ultimo_recordatorio_logros AS u FROM xp_users WHERE guildId = ? AND userId = ?")
            .get(guildId, userId)?.u;
        if (ultimo && ahora - Number(ultimo) < ESPERA_MS) continue;
        const { claimable } = achievements.getSummary(guildId, userId);
        if (claimable <= 0) continue;
        if (!(await enviarAviso(client, userId, "logros_pendientes", { embeds: [embedPendientes(guild, claimable)] }))) continue;
        db.prepare("UPDATE xp_users SET ultimo_recordatorio_logros = ? WHERE guildId = ? AND userId = ?").run(ahora, guildId, userId);
        enviados++;
    }
    log.info(`Recordatorio de logros sin reclamar: ${enviados} DMs enviados`);
}

module.exports = { runLogrosPendientesJob };
