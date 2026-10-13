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
// ─── Guardado diferido (#486) ─────────────────────────────────────────────────
// Tras cada respuesta del Duende se pedía reescribir TODO el historial (serializarlo y escribirlo a disco de forma
// síncrona): un coste que crece con los canales y que bloqueaba el camino de la respuesta. Ahora la respuesta solo marca
// el historial como pendiente (guardarDiferido) y, como mucho una vez cada ESPERA_GUARDADO_MS, se escribe en segundo
// plano, sin bloquear y con JSON compacto. Al apagar el bot se escribe lo pendiente (vaciarPendiente), así que tras un
// reinicio sigue el historial de las últimas 24 h. saveHistory sigue siendo el guardado inmediato (limpieza horaria).
const ESPERA_GUARDADO_MS = 5000;
let pendiente = false;
let temporizador = null;
let escribiendo = false;

async function escribirEnSegundoPlano() {
    if (!pendiente || escribiendo) return;
    escribiendo = true;
    pendiente = false;
    try {
        await fs.promises.writeFile(HISTORY_PATH + ".tmp", JSON.stringify(conversationHistory), "utf8");
        await fs.promises.rename(HISTORY_PATH + ".tmp", HISTORY_PATH);
    } catch (err) {
        pendiente = true; // se reintenta con el siguiente guardado
        log.error(`Error guardando historial: ${err.message}`);
    } finally {
        escribiendo = false;
    }
}

/** Marca el historial como pendiente de guardar; la escritura sale a lo sumo cada ESPERA_GUARDADO_MS, sin bloquear. */
function guardarDiferido() {
    pendiente = true;
    if (temporizador) return;
    temporizador = setTimeout(() => {
        temporizador = null;
        void escribirEnSegundoPlano().then(() => {
            if (pendiente) guardarDiferido();
        });
    }, ESPERA_GUARDADO_MS);
    temporizador.unref?.();
}

/** Escribe ya lo que esté pendiente (al apagar el bot, antes de salir). */
function vaciarPendiente() {
    if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
    }
    if (!pendiente) return;
    pendiente = false;
    saveHistory();
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
module.exports = { conversationHistory, saveHistory, guardarDiferido, vaciarPendiente, ESPERA_GUARDADO_MS };
