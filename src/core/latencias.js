// ⏱️ Latencias por manejador (#481): cuánto tarda cada camino caliente del bot, guardado como percentiles (p50 y p95) de
// las últimas muestras. Mide el procesado de mensajes (XP, recuerdos y Duende), los botones y formularios por prefijo de
// su customId y las tareas programadas. Solo mide: no cambia el comportamiento de nada. Se muestra en /paneladmin →
// Sistema → ⏱️ Latencias y se escribe en el log (nivel debug) cada minuto.
const { performance } = require("node:perf_hooks");
const { createLogger } = require("./logger");

const log = createLogger("Latencias");

/** Muestras que se guardan por manejador: los percentiles son de las últimas (una ventana, no de todo el arranque). */
const MAX_MUESTRAS = 512;
/** Manejadores distintos que se siguen a la vez, para que un customId raro no haga crecer el mapa sin fin. */
const MAX_MANEJADORES = 300;
const INTERVALO_LOG_MS = 60_000;

const series = new Map(); // "tipo|nombre" → { tipo, nombre, muestras: number[], siguiente, total }
let desdeUltimoLog = 0;

/** Anota lo que ha tardado un manejador (ms). `tipo`: mensaje, componente o tarea. */
function registrar(tipo, nombre, ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const clave = `${tipo}|${nombre}`;
    let s = series.get(clave);
    if (!s) {
        if (series.size >= MAX_MANEJADORES) return;
        s = { tipo, nombre, muestras: [], siguiente: 0, total: 0 };
        series.set(clave, s);
    }
    if (s.muestras.length < MAX_MUESTRAS) s.muestras.push(ms);
    else s.muestras[s.siguiente] = ms;
    s.siguiente = (s.siguiente + 1) % MAX_MUESTRAS;
    s.total++;
    desdeUltimoLog++;
}

/** El percentil `p` (0-100) de una lista de números, por el método del rango más cercano. */
function percentil(valores, p) {
    if (!valores.length) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    const rango = Math.max(1, Math.ceil((p / 100) * ordenados.length));
    return ordenados[rango - 1];
}

/** Cada manejador con sus llamadas y su p50 y p95 en ms, de más a menos lento (p95). */
function resumen({ tipo = null } = {}) {
    return [...series.values()]
        .filter((s) => !tipo || s.tipo === tipo)
        .map((s) => ({ tipo: s.tipo, nombre: s.nombre, n: s.total, p50: percentil(s.muestras, 50), p95: percentil(s.muestras, 95) }))
        .sort((a, b) => b.p95 - a.p95 || b.n - a.n);
}

const fmt = (ms) => (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2));

/** Una tabla de texto (p50 y p95 en ms) con los `limite` manejadores más lentos, o un aviso si aún no hay datos. */
function tabla(limite = 15) {
    const filas = resumen().slice(0, limite);
    if (!filas.length) return "Todavía no hay muestras desde el arranque.";
    const ancho = Math.min(32, Math.max(...filas.map((f) => `${f.tipo}:${f.nombre}`.length)));
    const linea = (a, b, c, d) => `${a.padEnd(ancho)} ${String(b).padStart(6)} ${String(c).padStart(8)} ${String(d).padStart(8)}`;
    return [
        linea("manejador", "n", "p50 ms", "p95 ms"),
        ...filas.map((f) => linea(`${f.tipo}:${f.nombre}`.slice(0, ancho), f.n, fmt(f.p50), fmt(f.p95))),
    ].join("\n");
}

/** El prefijo de un customId por el que se agrupan los botones y formularios: sus dos primeras partes (casino_play). */
function prefijoDe(customId) {
    return String(customId || "?")
        .split("_")
        .slice(0, 2)
        .join("_")
        .slice(0, 40);
}

/** Mide lo que tarda `fn` (síncrona o no) y lo anota, salga bien o falle. Devuelve lo que devuelva `fn`. */
async function medir(tipo, nombre, fn) {
    const t0 = performance.now();
    try {
        return await fn();
    } finally {
        registrar(tipo, nombre, performance.now() - t0);
    }
}

/** Cada minuto, en el log (debug), los manejadores más lentos. No hace nada si no ha habido muestras nuevas. */
function iniciarLog(intervaloMs = INTERVALO_LOG_MS, escribir = (texto) => log.debug(texto)) {
    const timer = setInterval(() => {
        if (!desdeUltimoLog) return;
        desdeUltimoLog = 0;
        escribir(`Latencias (últimas ${MAX_MUESTRAS} muestras por manejador):\n${tabla(10)}`);
    }, intervaloMs);
    timer.unref?.();
    return timer;
}

function reiniciar() {
    series.clear();
    desdeUltimoLog = 0;
}

module.exports = { MAX_MUESTRAS, MAX_MANEJADORES, registrar, percentil, resumen, tabla, prefijoDe, medir, iniciarLog, reiniciar };
