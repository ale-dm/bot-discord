// Registro de las tareas programadas (cron) y de su última ejecución, para verlas y lanzarlas desde 🩺 Sistema (#420, #421).
//
// - `cron` es node-cron con una anotación: cada `cron.schedule(expr, cb)` se apunta con el nombre de su primer `runJob("…")`
//   y su horario, así hay una lista aunque la tarea no haya corrido todavía.
// - `runJob` (core/interactionLog) avisa de cuándo empieza y acaba cada tarea: la última ejecución se guarda en la tabla
//   `tareas_ejecuciones`, así que sobrevive a un reinicio.
const nodeCron = require("node-cron");
const { createLogger } = require("./logger");

const log = createLogger("Tareas");

const registro = []; // { nombre, expr, cb, tarea }
const enCurso = new Set(); // nombres con una ejecución en marcha (programada o a mano)

function nombreDe(cb) {
    return /runJob\(\s*["'`]([^"'`]+)["'`]/.exec(String(cb))?.[1] ?? null;
}

const cron = {
    schedule(expr, cb, opciones) {
        const tarea = nodeCron.schedule(expr, cb, opciones);
        const nombre = nombreDe(cb);
        if (nombre && !registro.some((r) => r.nombre === nombre)) registro.push({ nombre, expr, cb, tarea });
        return tarea;
    },
};

/** `runJob` la llama al empezar. */
function empezar(nombre) {
    enCurso.add(nombre);
}

/** `runJob` la llama al acabar (bien o con error): marca la tarea libre y guarda la ejecución. Nunca lanza. */
function terminar(nombre, { inicio, ms, ok, error = null }) {
    enCurso.delete(nombre);
    try {
        require("./db")
            .prepare(
                `INSERT INTO tareas_ejecuciones (nombre, inicio, ms, ok, error) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(nombre) DO UPDATE SET inicio = excluded.inicio, ms = excluded.ms, ok = excluded.ok, error = excluded.error`,
            )
            .run(nombre, inicio, ms, ok ? 1 : 0, error ? String(error).slice(0, 300) : null);
    } catch (e) {
        log.debug(`No se pudo guardar la ejecución de "${nombre}": ${e.message}`);
    }
}

/** Las tareas programadas con su última ejecución (`ultima` null = «sin ejecutar») y la siguiente si node-cron la sabe. */
function listar() {
    const db = require("./db"); // al usarse, no al cargar: interactionLog lo importa y no debe abrir la base de datos
    const filas = new Map(
        db
            .prepare("SELECT nombre, inicio, ms, ok, error FROM tareas_ejecuciones")
            .all()
            .map((f) => [f.nombre, f]),
    );
    return registro.map(({ nombre, expr, tarea }, indice) => {
        const f = filas.get(nombre);
        let siguiente = null;
        try {
            siguiente = tarea?.getNextRun?.()?.getTime?.() ?? null;
        } catch {
            siguiente = null;
        }
        return {
            indice,
            nombre,
            expr,
            siguiente,
            enCurso: enCurso.has(nombre),
            ultima: f ? { inicio: f.inicio, ms: f.ms, ok: Boolean(f.ok), error: f.error } : null,
        };
    });
}

/**
 * Lanza una tarea ahora, como si fuera su hora. Una misma tarea no corre dos veces a la vez.
 * @returns {Promise<{ estado: "hecha" | "en_curso" | "desconocida", nombre?: string }>}
 */
async function lanzar(indice) {
    const entrada = registro[indice];
    if (!entrada) return { estado: "desconocida" };
    if (enCurso.has(entrada.nombre)) return { estado: "en_curso", nombre: entrada.nombre };
    enCurso.add(entrada.nombre); // por si la tarea tarda en llegar a runJob
    try {
        await entrada.cb();
    } finally {
        enCurso.delete(entrada.nombre);
    }
    return { estado: "hecha", nombre: entrada.nombre };
}

/** Solo para los tests. */
function _reiniciar() {
    registro.length = 0;
    enCurso.clear();
}

module.exports = { cron, empezar, terminar, listar, lanzar, _reiniciar };
