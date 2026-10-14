// Configuración de XP por servidor (con sus valores por defecto), títulos de rango, fórmula de
// coste de cada nivel, multiplicadores por usuario, canales ignorados y la fila de cada usuario.
const db = require("../../core/db");
const { CacheLimitada } = require("../../core/cacheLimitada");

const DEFAULT_CONFIG = {
    xp_message_base: "15",
    xp_message_len_bonus_max: "10",
    xp_message_cooldown_sec: "15",
    xp_voice_per_min: "5",
    xp_multiplier: "1",
    xp_announce_channel_id: "",
    xp_formula_base: "100",
    xp_formula_exp: "1.5",
    xp_level_cost_multiplier: "1.6",
    xp_level_requirement_multiplier: "10",
    streak_enabled: "1",
    streak_bonus_pct_per_day: "2",
    streak_bonus_cap_pct: "50",
    streak_grace_per_month: "0",
    xp_daily_cap: "0",
    xp_reaction_base: "3",
    xp_reaction_cooldown_sec: "60",
};

const DEFAULT_TITLES = [
    { level: 2, title: "BRONCE", emoji: "🥉" },
    { level: 10, title: "PLATA", emoji: "🥈" },
    { level: 15, title: "ORO", emoji: "🥇" },
    { level: 20, title: "PLATINO", emoji: "💠" },
    { level: 30, title: "DIAMANTE", emoji: "💎" },
    { level: 40, title: "MASTER", emoji: "🔷" },
    { level: 50, title: "GRANDMASTER", emoji: "🔹" },
    { level: 60, title: "PERRO", emoji: "🐶" },
    { level: 70, title: "MAMUT", emoji: "🦣" },
];

// Valores por defecto de un servidor: las claves de configuración que falten y los títulos
// de rango si no tiene ninguno. Solo rellena lo que no existe, así que nunca pisa lo que se
// cambie desde el panel. Se hace una vez por servidor y proceso (se llamaba en cada mensaje).
// (Roles de recompensa, canal de anuncios y multiplicadores ya no se siembran aquí:
// ver core/migrations/002_xp_valores_por_defecto.js.)
const seededGuilds = new CacheLimitada({ max: 500 });

// Las sentencias de lo que pasa en cada mensaje se preparan una vez (db.prepare por mensaje costaba más que ejecutarlas).
const preparadas = new Map();
function sentencia(sql) {
    let s = preparadas.get(sql);
    if (!s) {
        s = db.prepare(sql);
        preparadas.set(sql, s);
    }
    return s;
}

// Lo que se lee de la configuración de XP en cada mensaje (cooldown, base y bonus por longitud), por servidor. Se
// invalida al guardar cualquier valor con setConfig.
const configMensajes = new CacheLimitada({ max: 500 });

function ensureGuildDefaults(guildId) {
    if (seededGuilds.has(guildId)) return;
    const insertCfg = db.prepare(`INSERT OR IGNORE INTO xp_config (guildId, clave, valor) VALUES (?, ?, ?)`);
    db.transaction(() => {
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) insertCfg.run(guildId, k, v);
        const countTitles = db.prepare(`SELECT COUNT(*) AS total FROM xp_level_titles WHERE guildId = ?`).get(guildId)?.total || 0;
        if (!countTitles) {
            const insertTitle = db.prepare(`INSERT INTO xp_level_titles (guildId, nivel, title, emoji) VALUES (?, ?, ?, ?)`);
            for (const t of DEFAULT_TITLES) insertTitle.run(guildId, t.level, t.title, t.emoji);
        }
    })();
    seededGuilds.set(guildId, true);
}

function getConfig(guildId, key) {
    ensureGuildDefaults(guildId);
    return sentencia(`SELECT valor FROM xp_config WHERE guildId = ? AND clave = ?`).get(guildId, key)?.valor;
}

/** { cooldownSec, base, bonusMax } de la XP por mensaje de un servidor, guardado hasta el siguiente setConfig. */
function getConfigMensajes(guildId) {
    const guardada = configMensajes.get(guildId);
    if (guardada) return guardada;
    const valores = {
        cooldownSec: Number(getConfig(guildId, "xp_message_cooldown_sec") || 15),
        base: Number(getConfig(guildId, "xp_message_base") || 15),
        bonusMax: Number(getConfig(guildId, "xp_message_len_bonus_max") || 10),
    };
    configMensajes.set(guildId, valores);
    return valores;
}

/** Cuándo (ms) fue el último mensaje que dio XP a alguien, o null si no tiene fila o nunca. Solo lee: no crea nada. */
function getUltimoMensaje(guildId, userId) {
    return sentencia(`SELECT ultimo_msg FROM xp_users WHERE guildId = ? AND userId = ?`).get(guildId, userId)?.ultimo_msg ?? null;
}

const apuntarMensaje = db.transaction((guildId, userId, ahora) => {
    sentencia(`INSERT OR IGNORE INTO xp_users (guildId, userId) VALUES (?, ?)`).run(guildId, userId);
    sentencia(`UPDATE xp_users SET ultimo_msg = ? WHERE guildId = ? AND userId = ?`).run(ahora, guildId, userId);
});

/** Crea la fila de la persona si no existe y apunta el momento de su mensaje, en una sola transacción. */
function registrarMensaje(guildId, userId, ahora) {
    apuntarMensaje(guildId, userId, ahora);
}

function getAllConfig(guildId) {
    ensureGuildDefaults(guildId);
    const rows = db.prepare(`SELECT clave, valor FROM xp_config WHERE guildId = ?`).all(guildId);
    const out = {};
    for (const r of rows) out[r.clave] = r.valor;
    return out;
}

function setConfig(guildId, key, value) {
    ensureGuildDefaults(guildId);
    db.prepare(
        `
        INSERT INTO xp_config (guildId, clave, valor) VALUES (?, ?, ?)
        ON CONFLICT(guildId, clave) DO UPDATE SET valor = excluded.valor
    `,
    ).run(guildId, key, String(value));
    configMensajes.delete(guildId);
}

function ensureUser(guildId, userId) {
    sentencia(`INSERT OR IGNORE INTO xp_users (guildId, userId) VALUES (?, ?)`).run(guildId, userId);
    return sentencia(
        `SELECT guildId, userId, xp, nivel, xp_total, ultimo_msg, voz_inicio, voz_segundos, streak_dias, streak_last_day,
            streak_max, streak_gracia_mes, streak_gracia_usados, anuncios_off FROM xp_users WHERE guildId = ? AND userId = ?`,
    ).get(guildId, userId);
}

function getUserCostMultiplier(guildId, userId) {
    if (!userId) return 1;
    const row = db.prepare(`SELECT costMultiplier FROM xp_user_overrides WHERE guildId = ? AND userId = ?`).get(guildId, userId);
    return row ? Number(row.costMultiplier) : 1;
}

function setUserCostMultiplier(guildId, userId, multiplier) {
    const mult = Math.max(0.01, Number(multiplier) || 1);
    db.prepare(
        `
        INSERT INTO xp_user_overrides (guildId, userId, costMultiplier) VALUES (?, ?, ?)
        ON CONFLICT(guildId, userId) DO UPDATE SET costMultiplier = excluded.costMultiplier
    `,
    ).run(guildId, userId, mult);
    return mult;
}

function removeUserCostMultiplier(guildId, userId) {
    db.prepare(`DELETE FROM xp_user_overrides WHERE guildId = ? AND userId = ?`).run(guildId, userId);
}

function xpForNextLevel(level, guildId, userId = null) {
    const base = Number(getConfig(guildId, "xp_formula_base") || 100);
    const exp = Number(getConfig(guildId, "xp_formula_exp") || 1.5);
    const costMult = Number(getConfig(guildId, "xp_level_cost_multiplier") || 1.6);
    const requirementMult = Number(getConfig(guildId, "xp_level_requirement_multiplier") || 10);
    const userCostMult = getUserCostMultiplier(guildId, userId);
    return Math.max(1, Math.floor(base * Math.pow(level + 1, exp) * Math.max(1, costMult) * Math.max(1, requirementMult) * userCostMult));
}

function titleForLevel(guildId, level) {
    ensureGuildDefaults(guildId);
    return (
        db
            .prepare(
                `
        SELECT nivel, title, emoji
        FROM xp_level_titles
        WHERE guildId = ? AND nivel <= ?
        ORDER BY nivel DESC
        LIMIT 1
    `,
            )
            .get(guildId, level) || { nivel: 0, title: "SIN RANGO", emoji: "▫️" }
    );
}

function nextTitle(guildId, level) {
    ensureGuildDefaults(guildId);
    return (
        db
            .prepare(
                `
        SELECT nivel, title, emoji
        FROM xp_level_titles
        WHERE guildId = ? AND nivel > ?
        ORDER BY nivel ASC
        LIMIT 1
    `,
            )
            .get(guildId, level) || null
    );
}

function isIgnoredChannel(guildId, channelId) {
    if (!channelId) return false;
    return !!sentencia(`SELECT 1 FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?`).get(guildId, channelId);
}

function getIgnoredChannels(guildId) {
    return db.prepare(`SELECT channelId, channelName FROM xp_ignored_channels WHERE guildId = ? ORDER BY channelName ASC`).all(guildId);
}

function addIgnoredChannel(guildId, channelId, channelName) {
    db.prepare(
        `
        INSERT INTO xp_ignored_channels (guildId, channelId, channelName)
        VALUES (?, ?, ?)
        ON CONFLICT(guildId, channelId) DO UPDATE SET channelName = excluded.channelName
    `,
    ).run(guildId, channelId, channelName || null);
}

function removeIgnoredChannel(guildId, channelId) {
    db.prepare(`DELETE FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?`).run(guildId, channelId);
}

function clearIgnoredChannels(guildId) {
    db.prepare(`DELETE FROM xp_ignored_channels WHERE guildId = ?`).run(guildId);
}

/** ¿Tiene alguno de los roles sin XP (#362)? `member` es un GuildMember (o algo con `roles.cache`); sin él, no. */
function tieneRolIgnorado(guildId, member) {
    const roles = member?.roles?.cache;
    if (!roles || !roles.size) return false;
    return sentencia(`SELECT roleId FROM xp_ignored_roles WHERE guildId = ?`)
        .all(guildId)
        .some((r) => roles.has(r.roleId));
}

function getIgnoredRoles(guildId) {
    return db.prepare(`SELECT roleId, roleName FROM xp_ignored_roles WHERE guildId = ? ORDER BY roleName ASC`).all(guildId);
}

function addIgnoredRole(guildId, roleId, roleName) {
    db.prepare(
        `INSERT INTO xp_ignored_roles (guildId, roleId, roleName) VALUES (?, ?, ?)
         ON CONFLICT(guildId, roleId) DO UPDATE SET roleName = excluded.roleName`,
    ).run(guildId, roleId, roleName || null);
}

function removeIgnoredRole(guildId, roleId) {
    return db.prepare(`DELETE FROM xp_ignored_roles WHERE guildId = ? AND roleId = ?`).run(guildId, roleId).changes > 0;
}

/** El multiplicador de XP de un canal (#369): 1 si no tiene; 0 lo deja como ignorado. */
function multiplicadorCanal(guildId, channelId) {
    if (!channelId) return 1;
    const fila = sentencia(`SELECT multiplicador FROM xp_channel_multipliers WHERE guildId = ? AND channelId = ?`).get(guildId, channelId);
    return fila ? Number(fila.multiplicador) : 1;
}

function getMultiplicadoresCanal(guildId) {
    return db.prepare(`SELECT channelId, multiplicador FROM xp_channel_multipliers WHERE guildId = ? ORDER BY channelId`).all(guildId);
}

/** Guarda el multiplicador de un canal; el 1 (lo normal) lo quita. */
function setMultiplicadorCanal(guildId, channelId, multiplicador) {
    if (multiplicador === 1) {
        db.prepare(`DELETE FROM xp_channel_multipliers WHERE guildId = ? AND channelId = ?`).run(guildId, channelId);
        return;
    }
    db.prepare(
        `INSERT INTO xp_channel_multipliers (guildId, channelId, multiplicador) VALUES (?, ?, ?)
         ON CONFLICT(guildId, channelId) DO UPDATE SET multiplicador = excluded.multiplicador`,
    ).run(guildId, channelId, multiplicador);
}

/** Si alguien no quiere que se anuncie su subida de nivel (#373). */
function anunciosOff(guildId, userId) {
    return !!sentencia(`SELECT anuncios_off FROM xp_users WHERE guildId = ? AND userId = ?`).get(guildId, userId)?.anuncios_off;
}

function setAnunciosOff(guildId, userId, valor) {
    ensureUser(guildId, userId);
    sentencia(`UPDATE xp_users SET anuncios_off = ? WHERE guildId = ? AND userId = ?`).run(valor ? 1 : 0, guildId, userId);
}

/** Cuándo (ms) recibió XP por última vez por una reacción, o null (#358). */
function getUltimaReaccion(guildId, userId) {
    return sentencia(`SELECT ultima_reaccion FROM xp_users WHERE guildId = ? AND userId = ?`).get(guildId, userId)?.ultima_reaccion ?? null;
}

function registrarReaccion(guildId, userId, ahora) {
    ensureUser(guildId, userId);
    sentencia(`UPDATE xp_users SET ultima_reaccion = ? WHERE guildId = ? AND userId = ?`).run(ahora, guildId, userId);
}

function getTitles(guildId) {
    ensureGuildDefaults(guildId);
    return db.prepare(`SELECT nivel, title, emoji FROM xp_level_titles WHERE guildId = ? ORDER BY nivel ASC`).all(guildId);
}

module.exports = {
    ensureGuildDefaults,
    getConfig,
    getConfigMensajes,
    getAllConfig,
    setConfig,
    ensureUser,
    getUltimoMensaje,
    registrarMensaje,
    getUserCostMultiplier,
    setUserCostMultiplier,
    removeUserCostMultiplier,
    xpForNextLevel,
    titleForLevel,
    nextTitle,
    getTitles,
    isIgnoredChannel,
    getIgnoredChannels,
    addIgnoredChannel,
    removeIgnoredChannel,
    clearIgnoredChannels,
    tieneRolIgnorado,
    getIgnoredRoles,
    addIgnoredRole,
    removeIgnoredRole,
    multiplicadorCanal,
    getMultiplicadoresCanal,
    setMultiplicadorCanal,
    anunciosOff,
    setAnunciosOff,
    getUltimaReaccion,
    registrarReaccion,
};
