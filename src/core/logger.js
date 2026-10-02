// Logger del bot.
//
// Ficheros (en LOG_DIR, por defecto ./logs), todos con rotación por tamaño:
//   app-log.txt    todo, en orden cronológico (desde LOG_LEVEL hacia arriba)
//   warn-log.txt   solo avisos
//   error-log.txt  solo errores
//
// Formato de línea: `2026-09-24T07:30:09.134Z INFO  [Casino] mensaje`. Si un mensaje ocupa
// varias líneas (trazas de error), las siguientes van sangradas, así cada entrada empieza
// siempre por la fecha y se puede filtrar con grep.
//
// Uso recomendado, con logger por módulo:
//   const log = require('../../core/logger').createLogger('Tienda');
//   log.info('Compra', { userId, item });   log.error('Falló la compra', err);
// Las funciones antiguas (logInfo/logWarn/logError) siguen funcionando igual.

const fs = require("fs");
const path = require("path");
const util = require("util");

const { LOGS_DIR: logsDir } = require("./paths");
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Rotación por tamaño: al pasar de LOG_MAX_BYTES, `app-log.txt` pasa a `app-log.1.txt`,
// la .1 a .2, etc., conservando como mucho LOG_MAX_FILES antiguos.
const LOG_MAX_BYTES = Math.max(64 * 1024, Number(process.env.LOG_MAX_BYTES || 5 * 1024 * 1024));
const LOG_MAX_FILES = Math.max(1, Number(process.env.LOG_MAX_FILES || 5));
// Un solo mensaje enorme (un prompt completo, un JSON de error de una API) no debería
// poder llenar el log: se recorta a este tamaño.
const LOG_MAX_ENTRY_CHARS = Math.max(1000, Number(process.env.LOG_MAX_ENTRY_CHARS || 8000));

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_TAGS = { debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR" };

function parseLevel(value, fallback) {
    const v = String(value || "")
        .toLowerCase()
        .trim();
    return LEVELS[v] ? v : fallback;
}
// Nivel mínimo que se escribe en los ficheros. `debug` activa el detalle paso a paso
// (voz, prompts, decisiones del Duende...).
let minLevel = parseLevel(process.env.LOG_LEVEL, "info");
// Nivel mínimo que además se muestra por consola (lo que se ve en `docker logs`).
// `off` para no sacar nada (los tests lo usan).
const consoleSetting = String(process.env.LOG_CONSOLE_LEVEL || "warn")
    .toLowerCase()
    .trim();
const consoleLevel = consoleSetting === "off" ? null : parseLevel(consoleSetting, "warn");

// ─── Redacción de secretos ────────────────────────────────────────────────────
// Los errores de fetch/axios suelen incluir la URL completa, y varias APIs llevan la clave
// en la query (?key=, ?apiKey=, ?api_key=). Nada de eso debe acabar en un fichero de log.
const SECRET_ENV_VARS = ["TOKEN", "GOOGLE_API_KEY", "ODDS_API_KEY", "GIPHY_API_KEY", "OPENAI_API_KEY", "TAUTULLI_API_KEY", "SEERR_API_KEY"];
const extraSecrets = new Set();

/** Registra un secreto más a ocultar (p. ej. claves guardadas en la BD desde el panel). */
function registerSecret(value) {
    const s = String(value || "");
    if (s.length >= 8) extraSecrets.add(s);
}

function redact(text) {
    let out = text.replace(/([?&](?:api_?key|apikey|key|token|access_token)=)[^&\s"'<>]+/gi, "$1***");
    out = out.replace(/(x-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1***");
    out = out.replace(/(Bot\s+)[A-Za-z0-9._-]{30,}/g, "$1***");
    for (const name of SECRET_ENV_VARS) {
        const v = process.env[name];
        if (v && v.length >= 8) out = out.split(v).join("***");
    }
    for (const v of extraSecrets) out = out.split(v).join("***");
    return out;
}

// ─── Formato ──────────────────────────────────────────────────────────────────
// Errores: traza completa + causa encadenada + los datos útiles de errores de Discord
// (código, estado HTTP, método y ruta) y de axios (estado y URL).
function formatError(err, depth = 0) {
    let out = err.stack || `${err.name || "Error"}: ${err.message}`;
    const extra = [];
    if (err.code !== undefined) extra.push(`code=${err.code}`);
    if (err.status !== undefined) extra.push(`status=${err.status}`);
    if (err.method) extra.push(`method=${err.method}`);
    if (err.url) extra.push(`url=${err.url}`);
    if (err.response?.status !== undefined) extra.push(`httpStatus=${err.response.status}`);
    if (err.config?.url) extra.push(`url=${err.config.method ? err.config.method.toUpperCase() + " " : ""}${err.config.url}`);
    if (extra.length) out += `\n(${extra.join(", ")})`;
    if (err.cause && depth < 3) {
        out += "\nCausado por: " + (err.cause instanceof Error ? formatError(err.cause, depth + 1) : inspect(err.cause));
    }
    return out;
}

function inspect(value) {
    return util.inspect(value, { depth: 4, breakLength: Infinity, maxArrayLength: 20, maxStringLength: 2000 });
}

function formatArg(a) {
    if (a instanceof Error) return formatError(a);
    if (typeof a === "string") return a;
    if (a === undefined || a === null) return String(a ?? "");
    if (typeof a === "object") return inspect(a);
    return String(a);
}

function format(args) {
    let text = args.map(formatArg).join(" ");
    if (text.length > LOG_MAX_ENTRY_CHARS) {
        text = text.slice(0, LOG_MAX_ENTRY_CHARS) + ` … [recortado, ${text.length} caracteres en total]`;
    }
    return redact(text);
}

// ─── Ficheros ─────────────────────────────────────────────────────────────────
// type -> { stream, size }. WriteStream (asíncrono, con buffer), no appendFileSync.
const streams = new Map();

function logPath(type, n = 0) {
    return path.join(logsDir, n ? `${type}-log.${n}.txt` : `${type}-log.txt`);
}

function openStream(type) {
    const p = logPath(type);
    let size = 0;
    try {
        size = fs.statSync(p).size;
    } catch {}
    // Apertura síncrona: con createWriteStream(path) el fichero se abre más tarde, y una
    // rotación en plena ráfaga de logs intentaría renombrar un fichero que aún no existe.
    const stream = fs.createWriteStream(null, { fd: fs.openSync(p, "a") });
    stream.on("error", (err) => console.error(`Error al escribir en el archivo de log (${type}):`, err));
    const entry = { stream, size };
    streams.set(type, entry);
    return entry;
}

function rotate(type, entry) {
    try {
        // Renombrar con el stream aún abierto es seguro (Linux, y Windows vía libuv con
        // FILE_SHARE_DELETE): lo que quede en su buffer acaba en el fichero ya rotado.
        const oldest = logPath(type, LOG_MAX_FILES);
        if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        for (let n = LOG_MAX_FILES - 1; n >= 1; n--) {
            const from = logPath(type, n);
            if (fs.existsSync(from)) fs.renameSync(from, logPath(type, n + 1));
        }
        fs.renameSync(logPath(type), logPath(type, 1));
    } catch (err) {
        console.error(`Error rotando el log (${type}):`, err);
    }
    entry.stream.end();
    return openStream(type);
}

function writeTo(type, line) {
    const bytes = Buffer.byteLength(line);
    let entry = streams.get(type) || openStream(type);
    if (entry.size > 0 && entry.size + bytes > LOG_MAX_BYTES) entry = rotate(type, entry);
    entry.stream.write(line);
    entry.size += bytes;
}

function buildLine(level, scope, text) {
    const head = `${new Date().toISOString()} ${LEVEL_TAGS[level]} ${scope ? `[${scope}] ` : ""}`;
    // Continuaciones sangradas: cada entrada empieza por la fecha.
    return head + text.replace(/\r?\n/g, "\n    ") + "\n";
}

// Contadores desde el arranque (los muestra /diagnostico).
const stats = { warn: 0, error: 0, lastError: null, since: Date.now() };

// Quien quiera enterarse de cada error (las alertas por DM al admin, systems/alertas). Un fallo en un oyente no
// puede tumbar el log, y un error registrado mientras se avisa de otro no vuelve a avisar (sin bucles).
const errorListeners = new Set();
let avisandoError = false;

/** Llama a `fn({ scope, message })` con cada error registrado. @returns {() => void} para quitarlo */
function onError(fn) {
    errorListeners.add(fn);
    return () => errorListeners.delete(fn);
}

function avisarError(scope, message) {
    if (avisandoError || !errorListeners.size) return;
    avisandoError = true;
    try {
        for (const fn of errorListeners) {
            try {
                fn({ scope, message });
            } catch (err) {
                console.error("Error en un oyente de errores del log:", err);
            }
        }
    } finally {
        avisandoError = false;
    }
}

// Consola "bonita" para desarrollo (LOG_PRETTY=1, lo activa scripts/dev.js): hora corta,
// color por nivel y solo la primera línea (la traza completa queda en el fichero). Sin
// LOG_PRETTY (Docker) la consola recibe la misma línea completa que los ficheros.
const PRETTY = process.env.LOG_PRETTY === "1";
const COLOR = PRETTY && (process.env.FORCE_COLOR === "1" || process.stdout.isTTY) && !process.env.NO_COLOR;
const LEVEL_PRETTY = { debug: ["90", "·"], info: ["37", "·"], warn: ["33", "!"], error: ["31", "✗"] };

function consoleLine(level, scope, text) {
    if (!PRETTY) return buildLine(level, scope, text);
    const [code, mark] = LEVEL_PRETTY[level];
    const paint = (c, str) => (COLOR ? `\x1b[${c}m${str}\x1b[0m` : str);
    const hora = new Date().toLocaleTimeString("es-ES", { hour12: false });
    const [primera, ...resto] = text.split("\n");
    const extra = resto.length ? paint("90", `  (detalle en logs/${level === "error" ? "error" : "app"}-log.txt)`) : "";
    return `${paint("90", hora)} ${paint(code, mark)} ${scope ? paint("90", `[${scope}] `) : ""}${paint(level === "info" || level === "debug" ? "0" : code, primera)}${extra}\n`;
}

function emit(level, scope, args) {
    if (LEVELS[level] < LEVELS[minLevel] && !(consoleLevel && LEVELS[level] >= LEVELS[consoleLevel])) return;
    const text = format(args);
    if (level === "warn") stats.warn++;
    if (level === "error") {
        stats.error++;
        stats.lastError = { at: Date.now(), scope, message: text.split("\n")[0].slice(0, 200) };
    }
    const line = buildLine(level, scope, text);
    if (LEVELS[level] >= LEVELS[minLevel]) {
        writeTo("app", line);
        if (level === "warn" || level === "error") writeTo(level, line);
    }
    if (consoleLevel && LEVELS[level] >= LEVELS[consoleLevel]) {
        (level === "error" || level === "warn" ? process.stderr : process.stdout).write(consoleLine(level, scope, text));
    }
    if (level === "error") avisarError(scope, stats.lastError.message);
}

// ─── API ──────────────────────────────────────────────────────────────────────
/**
 * Logger con ámbito: todo lo que registre sale con `[scope]` delante.
 * @param {string} scope - nombre del módulo o sistema (p. ej. "Blackjack", "XP", "Seerr")
 */
function createLogger(scope) {
    return {
        debug: (...args) => emit("debug", scope, args),
        info: (...args) => emit("info", scope, args),
        warn: (...args) => emit("warn", scope, args),
        error: (...args) => emit("error", scope, args),
        child: (sub) => createLogger(`${scope}:${sub}`),
        isDebugEnabled: () => LEVELS.debug >= LEVELS[minLevel],
    };
}

function logDebug(...args) {
    emit("debug", null, args);
}
function logInfo(...args) {
    emit("info", null, args);
}
function logWarn(...args) {
    emit("warn", null, args);
}
function logError(...args) {
    emit("error", null, args);
}

// Escribe de forma síncrona: para el último mensaje antes de que el proceso muera,
// cuando no hay garantía de que el buffer del stream llegue a vaciarse.
function logErrorSync(...args) {
    const line = buildLine("error", null, format(args));
    for (const type of ["app", "error"]) {
        try {
            fs.appendFileSync(logPath(type), line);
        } catch (err) {
            console.error(`Error al escribir en el archivo de log (${type}):`, err);
        }
    }
    if (consoleLevel) process.stderr.write(PRETTY ? consoleLine("error", null, format(args)) : line);
}

function setLogLevel(level) {
    minLevel = parseLevel(level, minLevel);
    return minLevel;
}

function getLogLevel() {
    return minLevel;
}

function getLogStats() {
    return { ...stats, level: minLevel, consoleLevel: consoleLevel || "off", dir: logsDir };
}

// Vacía y cierra todos los streams. Resuelve cuando están cerrados (o a los 2 s).
function flushLogs() {
    const pending = [...streams.values()].map(({ stream }) => new Promise((resolve) => stream.end(resolve)));
    streams.clear();
    return Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
}

module.exports = {
    createLogger,
    logDebug,
    logInfo,
    logWarn,
    logError,
    logErrorSync,
    flushLogs,
    registerSecret,
    setLogLevel,
    getLogLevel,
    getLogStats,
    onError,
    // Para tests
    __test: { format, redact, buildLine },
};
