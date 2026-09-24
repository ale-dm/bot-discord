// Historial reciente de conversación por canal (data/duende-history.json). Las personalidades,
// los perfiles de personas y la personalidad de cada canal están en la BD (./perfiles.js).
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende");

const { DATA_DIR } = require("../../core/paths");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const HISTORY_PATH = path.join(DATA_DIR, "duende-history.json");

let conversationHistory = {};
if (fs.existsSync(HISTORY_PATH)) {
    try {
        conversationHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    } catch (err) {
        log.error(`Error leyendo historial: ${err.message}`);
        conversationHistory = {};
    }
}
function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_PATH + ".tmp", JSON.stringify(conversationHistory, null, 2), "utf8");
        fs.renameSync(HISTORY_PATH + ".tmp", HISTORY_PATH);
    } catch (err) {
        log.error(`Error guardando historial: ${err.message}`);
    }
}
function cleanOldHistories() {
    const now = Date.now();
    let changed = false;
    for (const [channelId, history] of Object.entries(conversationHistory)) {
        const last = history[history.length - 1];
        if (last && last.timestamp && now - last.timestamp > 24 * 60 * 60 * 1000) {
            delete conversationHistory[channelId];
            changed = true;
        }
    }
    if (changed) saveHistory();
}
setInterval(cleanOldHistories, 60 * 60 * 1000).unref();

// conversationHistory se modifica en el sitio (nunca se reasigna), así que quien lo importa ve
// siempre el estado actual.
module.exports = { conversationHistory, saveHistory };
