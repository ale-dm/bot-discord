const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Auditoría");

// Campos cuyo nombre sugiere un secreto (api_key, token...) no se copian tal cual al log.
function maskSecrets(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(maskSecrets);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = /api[_.-]?key|token|secret|password/i.test(k) && v ? "***" : maskSecrets(v);
    }
    return out;
}

function logAdminAction({ guildId, actorId, action, details }) {
    if (!guildId || !actorId || !action) {
        log.warn(`Acción de admin sin datos suficientes para auditar: ${JSON.stringify({ guildId, actorId, action })}`);
        return false;
    }
    // Copia en el log de fichero: si la tabla falla o se borra, la acción sigue constando.
    log.info(`${action} por ${actorId} en ${guildId}${details ? ` · ${JSON.stringify(maskSecrets(details))}` : ""}`);
    try {
        db.prepare(
            `
            INSERT INTO admin_audit (guildId, actorId, action, details, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `,
        ).run(guildId, actorId, action, details ? JSON.stringify(details) : null, Date.now());
        return true;
    } catch (e) {
        log.error(`No se pudo guardar en admin_audit la acción ${action} de ${actorId}:`, e);
        return false;
    }
}

function listRecent(guildId, limit = 20) {
    if (!guildId) return [];
    const rows = db
        .prepare(
            `
        SELECT id, actorId, action, details, createdAt
        FROM admin_audit
        WHERE guildId = ?
        ORDER BY id DESC
        LIMIT ?
    `,
        )
        .all(guildId, Math.max(1, Math.min(100, Number(limit) || 20)));

    return rows.map((row) => ({
        ...row,
        details: row.details ? safeParse(row.details) : null,
    }));
}

function safeParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

module.exports = {
    logAdminAction,
    listRecent,
};
