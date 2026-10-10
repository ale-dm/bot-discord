// Límites de uso por día y por persona.

const db = require("../../core/db");
const { createLogger } = require("../../core/logger");

const log = createLogger("Ajustes");
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function checkAndConsumeLimit(guildId, scope, userId, options = {}) {
    if (!guildId || !scope || !userId) return { ok: true };
    const cooldownSec = Number(options.cooldownSec || 0);
    const dailyLimit = Number(options.dailyLimit || 0);
    const now = Date.now();
    const today = todayKey();

    const row = db
        .prepare("SELECT lastTs, day, dayCount FROM action_limits WHERE guildId = ? AND scope = ? AND userId = ?")
        .get(guildId, scope, userId);

    if (row && cooldownSec > 0) {
        const diff = now - Number(row.lastTs || 0);
        if (diff < cooldownSec * 1000) {
            const retry = Math.ceil((cooldownSec * 1000 - diff) / 1000);
            log.info(`Límite ${scope}: ${userId} en cooldown (faltan ${retry} s)`);
            return { ok: false, reason: "cooldown", retrySeconds: retry };
        }
    }

    let countToday = 0;
    if (row && row.day === today) countToday = Number(row.dayCount || 0);
    if (dailyLimit > 0 && countToday >= dailyLimit) {
        log.info(`Límite ${scope}: ${userId} alcanzó el cupo diario (${dailyLimit})`);
        return { ok: false, reason: "daily" };
    }

    // Con consume: false solo se comprueba el cupo (p. ej. antes de hacer algo que puede fallar).
    if (options.consume === false) return { ok: true };

    const nextCount = row && row.day === today ? countToday + 1 : 1;
    db.prepare(
        `
        INSERT INTO action_limits (guildId, scope, userId, lastTs, day, dayCount)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guildId, scope, userId) DO UPDATE SET
            lastTs = excluded.lastTs,
            day = excluded.day,
            dayCount = excluded.dayCount
    `,
    ).run(guildId, scope, userId, now, today, nextCount);

    return { ok: true };
}

module.exports = { todayKey, checkAndConsumeLimit };
