const db = require("../core/db");
const { createLogger, registerSecret } = require("../core/logger");

const log = createLogger("Ajustes");

const DEFAULT_FLAT = {
    "duende.model": "",
    "duende.temperature": 0.7,
    "duende.history_limit": 20,
    "duende.allowed_channel_id": "",
    "duende.espontaneo_enabled": 1,
    "duende.espontaneo_channel_id": "",

    "cripto.ttcl_base_price": 100,
    "cripto.ttcl_volatility": 40,
    "cripto.fee_buy_pct": 0,
    "cripto.fee_sell_pct": 0,
    "cripto.cooldown_buy_sec": 0,
    "cripto.cooldown_sell_sec": 0,
    "cripto.min_buy": 100,
    "cripto.max_buy": 500000,
    "cripto.min_sell": 100,
    "cripto.max_sell": 500000,

    "casino.min_bet": 10,
    "casino.max_bet": 100000,
    "casino.global_cooldown_sec": 0,
    "casino.daily_limit": 0,
    "casino.rtp_blackjack": 100,
    "casino.rtp_tragaperras": 100,
    "casino.rtp_ruleta": 100,
    "casino.rtp_adivinar": 100,

    "tienda.enabled": true,
    "tienda.buy_cooldown_sec": 0,
    "tienda.daily_limit": 0,
    "tienda.notif_channel_id": "",

    "logros.enabled": true,
    "logros.notify_channel_id": "",
    "logros.reward_multiplier": 1,
    "logros.disabled_categories": "",

    "plex.tautulli_url": "",
    "plex.tautulli_api_key": "",
    "plex.novedades_channel_id": "",
    "plex.bibliotecas_anime": "",
    "plex.ranking_canal": "",
    "plex.ranking_ultima_semana": "",
    "plex.importacion_pct": 50,
    "plex.rol_gordos_1": "",
    "plex.rol_gordos_5": "",
    "plex.rol_gordos_10": "",

    "seerr.url": "",
    "seerr.api_key": "",
    "seerr.daily_request_limit": 5,
    "seerr.avisar_disponible": true,

    "diario.enabled": true,
    "diario.base": 100,
    "diario.por_dia_racha": 20,
    "diario.tope": 500,

    "apuestas.canal_resultados": "",
    "apuestas.recordatorio": true,
    "apuestas.recordatorio_min": 30,

    "alertas.enabled": true,
    "alertas.admin_ids": "",

    "clasificacion.canal": "",
    "clasificacion.premio": 500,
    "clasificacion.ultima_semana": "",
};

const KEY_TYPES = {
    "duende.model": "string",
    "duende.temperature": "number",
    "duende.history_limit": "number",
    "duende.allowed_channel_id": "string",
    "duende.espontaneo_enabled": "number",
    "duende.espontaneo_channel_id": "string",

    "cripto.ttcl_base_price": "number",
    "cripto.ttcl_volatility": "number",
    "cripto.fee_buy_pct": "number",
    "cripto.fee_sell_pct": "number",
    "cripto.cooldown_buy_sec": "number",
    "cripto.cooldown_sell_sec": "number",
    "cripto.min_buy": "number",
    "cripto.max_buy": "number",
    "cripto.min_sell": "number",
    "cripto.max_sell": "number",

    "casino.min_bet": "number",
    "casino.max_bet": "number",
    "casino.global_cooldown_sec": "number",
    "casino.daily_limit": "number",
    "casino.rtp_blackjack": "number",
    "casino.rtp_tragaperras": "number",
    "casino.rtp_ruleta": "number",
    "casino.rtp_adivinar": "number",

    "tienda.enabled": "boolean",
    "tienda.buy_cooldown_sec": "number",
    "tienda.daily_limit": "number",
    "tienda.notif_channel_id": "string",

    "logros.enabled": "boolean",
    "logros.notify_channel_id": "string",
    "logros.reward_multiplier": "number",
    "logros.disabled_categories": "string",

    "plex.tautulli_url": "string",
    "plex.tautulli_api_key": "string",
    "plex.novedades_channel_id": "string",
    "plex.bibliotecas_anime": "string",
    "plex.ranking_canal": "string",
    "plex.ranking_ultima_semana": "string",
    "plex.importacion_pct": "number",
    "plex.rol_gordos_1": "string",
    "plex.rol_gordos_5": "string",
    "plex.rol_gordos_10": "string",

    "seerr.url": "string",
    "seerr.api_key": "string",
    "seerr.daily_request_limit": "number",
    "seerr.avisar_disponible": "boolean",

    "diario.enabled": "boolean",
    "diario.base": "number",
    "diario.por_dia_racha": "number",
    "diario.tope": "number",

    "apuestas.canal_resultados": "string",
    "apuestas.recordatorio": "boolean",
    "apuestas.recordatorio_min": "number",

    "alertas.enabled": "boolean",
    "alertas.admin_ids": "string",

    "clasificacion.canal": "string",
    "clasificacion.premio": "number",
    "clasificacion.ultima_semana": "string",
};

function parseValue(key, value) {
    const type = KEY_TYPES[key] || "string";
    if (type === "number") {
        const num = Number(value);
        return Number.isFinite(num) ? num : Number(DEFAULT_FLAT[key] || 0);
    }
    if (type === "boolean") {
        if (typeof value === "boolean") return value;
        const normalized = String(value || "").toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "si";
    }
    return String(value ?? "");
}

function flattenToNested(flat) {
    return {
        duende: {
            model: flat["duende.model"],
            temperature: flat["duende.temperature"],
            history_limit: flat["duende.history_limit"],
            allowed_channel_id: flat["duende.allowed_channel_id"],
            espontaneo_enabled: !!flat["duende.espontaneo_enabled"],
            espontaneo_channel_id: flat["duende.espontaneo_channel_id"],
        },
        cripto: {
            ttcl_base_price: flat["cripto.ttcl_base_price"],
            ttcl_volatility: flat["cripto.ttcl_volatility"],
            fee_buy_pct: flat["cripto.fee_buy_pct"],
            fee_sell_pct: flat["cripto.fee_sell_pct"],
            cooldown_buy_sec: flat["cripto.cooldown_buy_sec"],
            cooldown_sell_sec: flat["cripto.cooldown_sell_sec"],
            min_buy: flat["cripto.min_buy"],
            max_buy: flat["cripto.max_buy"],
            min_sell: flat["cripto.min_sell"],
            max_sell: flat["cripto.max_sell"],
        },
        casino: {
            min_bet: flat["casino.min_bet"],
            max_bet: flat["casino.max_bet"],
            global_cooldown_sec: flat["casino.global_cooldown_sec"],
            daily_limit: flat["casino.daily_limit"],
            rtp_blackjack: flat["casino.rtp_blackjack"],
            rtp_tragaperras: flat["casino.rtp_tragaperras"],
            rtp_ruleta: flat["casino.rtp_ruleta"],
            rtp_adivinar: flat["casino.rtp_adivinar"],
        },
        tienda: {
            enabled: flat["tienda.enabled"],
            buy_cooldown_sec: flat["tienda.buy_cooldown_sec"],
            daily_limit: flat["tienda.daily_limit"],
            notif_channel_id: flat["tienda.notif_channel_id"],
        },
        logros: {
            enabled: flat["logros.enabled"],
            notify_channel_id: flat["logros.notify_channel_id"],
            reward_multiplier: flat["logros.reward_multiplier"],
            disabled_categories: flat["logros.disabled_categories"],
        },
        plex: {
            tautulli_url: flat["plex.tautulli_url"],
            tautulli_api_key: flat["plex.tautulli_api_key"],
            novedades_channel_id: flat["plex.novedades_channel_id"],
            bibliotecas_anime: flat["plex.bibliotecas_anime"],
            ranking_canal: flat["plex.ranking_canal"],
            ranking_ultima_semana: flat["plex.ranking_ultima_semana"],
            importacion_pct: flat["plex.importacion_pct"],
            rol_gordos_1: flat["plex.rol_gordos_1"],
            rol_gordos_5: flat["plex.rol_gordos_5"],
            rol_gordos_10: flat["plex.rol_gordos_10"],
        },
        seerr: {
            url: flat["seerr.url"],
            api_key: flat["seerr.api_key"],
            daily_request_limit: flat["seerr.daily_request_limit"],
            avisar_disponible: flat["seerr.avisar_disponible"],
        },
        diario: {
            enabled: flat["diario.enabled"],
            base: flat["diario.base"],
            por_dia_racha: flat["diario.por_dia_racha"],
            tope: flat["diario.tope"],
        },
        apuestas: {
            canal_resultados: flat["apuestas.canal_resultados"],
            recordatorio: flat["apuestas.recordatorio"],
            recordatorio_min: flat["apuestas.recordatorio_min"],
        },
        alertas: {
            enabled: flat["alertas.enabled"],
            admin_ids: flat["alertas.admin_ids"],
        },
        clasificacion: {
            canal: flat["clasificacion.canal"],
            premio: flat["clasificacion.premio"],
            ultima_semana: flat["clasificacion.ultima_semana"],
        },
    };
}

function getFlatSettings(guildId) {
    const flat = { ...DEFAULT_FLAT };
    if (!guildId) return flat;
    const rows = db.prepare("SELECT key, value FROM guild_settings WHERE guildId = ?").all(guildId);
    for (const row of rows) {
        if (!(row.key in DEFAULT_FLAT)) continue;
        flat[row.key] = parseValue(row.key, row.value);
    }
    return flat;
}

function getSettings(guildId) {
    return flattenToNested(getFlatSettings(guildId));
}

// Las claves de API que se guardan desde el panel se ocultan en los logs a partir de ya.
function logSettingChange(guildId, key, parsed) {
    const secreto = /api_key$/.test(key);
    if (secreto) registerSecret(parsed);
    log.debug(`${guildId}: ${key} = ${secreto ? "***" : JSON.stringify(parsed)}`);
}

function setSetting(guildId, key, value) {
    if (!guildId || !(key in DEFAULT_FLAT)) {
        log.warn(`setSetting ignorado: clave desconocida "${key}" o sin servidor (${guildId})`);
        return false;
    }
    const parsed = parseValue(key, value);
    logSettingChange(guildId, key, parsed);
    db.prepare(
        `
        INSERT INTO guild_settings (guildId, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(guildId, key) DO UPDATE SET value = excluded.value
    `,
    ).run(guildId, key, String(parsed));
    return true;
}

function setManySettings(guildId, entries) {
    if (!guildId || !entries || typeof entries !== "object") return 0;
    const tx = db.transaction(() => {
        let count = 0;
        for (const [key, value] of Object.entries(entries)) {
            if (!(key in DEFAULT_FLAT)) {
                log.warn(`setManySettings: clave desconocida "${key}" ignorada`);
                continue;
            }
            const parsed = parseValue(key, value);
            logSettingChange(guildId, key, parsed);
            db.prepare(
                `
                INSERT INTO guild_settings (guildId, key, value)
                VALUES (?, ?, ?)
                ON CONFLICT(guildId, key) DO UPDATE SET value = excluded.value
            `,
            ).run(guildId, key, String(parsed));
            count++;
        }
        return count;
    });
    return tx();
}

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

module.exports = {
    DEFAULT_FLAT,
    parseCsvIds,
    getSettings,
    getFlatSettings,
    setSetting,
    setManySettings,
    getCommandAcl,
    setCommandAcl,
    listCommandAcl,
    isCommandAllowed,
    checkAndConsumeLimit,
};
