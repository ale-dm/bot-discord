// Permisos de comandos por servidor (quién puede usar cada uno).

const db = require("../../core/db");
const { createLogger } = require("../../core/logger");

const log = createLogger("Ajustes");
function parseCsvIds(raw) {
    if (!raw) return [];
    return String(raw)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}

function toCsv(ids) {
    return (ids || [])
        .map((v) => String(v).trim())
        .filter(Boolean)
        .join(",");
}

function getCommandAcl(guildId, command) {
    if (!guildId || !command) {
        return { enabled: true, allowedChannels: [], allowedRoles: [] };
    }
    const row = db
        .prepare("SELECT enabled, allowedChannels, allowedRoles FROM command_acl WHERE guildId = ? AND command = ?")
        .get(guildId, command);
    if (!row) return { enabled: true, allowedChannels: [], allowedRoles: [] };
    return {
        enabled: Number(row.enabled) !== 0,
        allowedChannels: parseCsvIds(row.allowedChannels),
        allowedRoles: parseCsvIds(row.allowedRoles),
    };
}

function setCommandAcl(guildId, command, acl = {}) {
    if (!guildId || !command) return false;
    const current = getCommandAcl(guildId, command);
    const next = {
        enabled: typeof acl.enabled === "boolean" ? acl.enabled : current.enabled,
        allowedChannels: Array.isArray(acl.allowedChannels) ? acl.allowedChannels : current.allowedChannels,
        allowedRoles: Array.isArray(acl.allowedRoles) ? acl.allowedRoles : current.allowedRoles,
    };

    db.prepare(
        `
        INSERT INTO command_acl (guildId, command, enabled, allowedChannels, allowedRoles)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guildId, command) DO UPDATE SET
            enabled = excluded.enabled,
            allowedChannels = excluded.allowedChannels,
            allowedRoles = excluded.allowedRoles
    `,
    ).run(guildId, command, next.enabled ? 1 : 0, toCsv(next.allowedChannels), toCsv(next.allowedRoles));
    log.info(
        `ACL de /${command} en ${guildId}: ${next.enabled ? "activo" : "DESACTIVADO"} · canales=[${toCsv(next.allowedChannels) || "todos"}] · roles=[${toCsv(next.allowedRoles) || "todos"}]`,
    );
    return true;
}

function listCommandAcl(guildId) {
    if (!guildId) return [];
    const rows = db
        .prepare("SELECT command, enabled, allowedChannels, allowedRoles FROM command_acl WHERE guildId = ? ORDER BY command ASC")
        .all(guildId);
    return rows.map((row) => ({
        command: row.command,
        enabled: Number(row.enabled) !== 0,
        allowedChannels: parseCsvIds(row.allowedChannels),
        allowedRoles: parseCsvIds(row.allowedRoles),
    }));
}

function isCommandAllowed(interaction, commandName) {
    if (!interaction?.guildId || !commandName) return { ok: true };
    const acl = getCommandAcl(interaction.guildId, commandName);
    if (!acl.enabled) {
        return { ok: false, message: `⛔ El comando /${commandName} está deshabilitado en este servidor.` };
    }

    if (acl.allowedChannels.length > 0 && !acl.allowedChannels.includes(interaction.channelId)) {
        return { ok: false, message: `⛔ /${commandName} no está permitido en este canal.` };
    }

    if (acl.allowedRoles.length > 0) {
        const memberRoles = interaction.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : [];
        const hasAllowedRole = memberRoles.some((roleId) => acl.allowedRoles.includes(roleId));
        if (!hasAllowedRole) {
            return { ok: false, message: `⛔ /${commandName} requiere uno de los roles permitidos.` };
        }
    }

    return { ok: true };
}

module.exports = { parseCsvIds, toCsv, getCommandAcl, setCommandAcl, listCommandAcl, isCommandAllowed };
