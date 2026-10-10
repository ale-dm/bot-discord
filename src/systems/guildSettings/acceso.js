// Leer y escribir ajustes: la caché por servidor y la escritura con su registro.

const db = require("../../core/db");
const { createLogger, registerSecret } = require("../../core/logger");
const { DEFAULT_FLAT } = require("./definicion");
const { parseValue, flattenToNested } = require("./valores");

const log = createLogger("Ajustes");
const cacheAjustes = new Map();

function getFlatSettings(guildId) {
    if (!guildId) return { ...DEFAULT_FLAT };
    const id = String(guildId);
    if (!cacheAjustes.has(id)) {
        const flat = { ...DEFAULT_FLAT };
        const rows = db.prepare("SELECT key, value FROM guild_settings WHERE guildId = ?").all(id);
        for (const row of rows) {
            if (!(row.key in DEFAULT_FLAT)) continue;
            flat[row.key] = parseValue(row.key, row.value);
        }
        cacheAjustes.set(id, flat);
    }
    // Copia: quien llama puede cambiar lo que recibe sin tocar la caché (los valores son primitivos).
    return { ...cacheAjustes.get(id) };
}

function invalidarAjustes(guildId) {
    cacheAjustes.delete(String(guildId));
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
    invalidarAjustes(guildId);
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
    const n = tx();
    invalidarAjustes(guildId);
    return n;
}

module.exports = { cacheAjustes, getFlatSettings, invalidarAjustes, getSettings, logSettingChange, setSetting, setManySettings };
