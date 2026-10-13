// 📊 Encuestas rápidas (#426): una pregunta con de 2 a 5 opciones, un voto por persona (cambiarlo reemplaza el anterior), y se
// cierra al cabo de un tiempo o cuando la cierra quien la creó. Solo se enseña el recuento, no quién votó qué. Sin nada de
// Discord: el mensaje con los botones está en paneles/encuesta.js y el comando en commands/general/encuesta.js.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Encuestas");

const MIN_OPCIONES = 2;
const MAX_OPCIONES = 5;
const MIN_PREGUNTA = 3;
const MAX_PREGUNTA = 200;
/** Lo que cabe en la etiqueta de un botón de Discord. */
const MAX_OPCION = 80;
const HORAS_POR_DEFECTO = 24;
const MIN_HORAS = 1;
const MAX_HORAS = 168;

const error = (mensaje) => ({ ok: false, mensaje });

/**
 * Valida una encuesta antes de publicarla: la pregunta, y de 2 a 5 opciones sin repetir ni vacías.
 * @returns {{ ok: true, pregunta: string, opciones: string[] } | { ok: false, mensaje: string }}
 */
function validarEncuesta({ pregunta, opciones }) {
    const texto = String(pregunta ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (texto.length < MIN_PREGUNTA || texto.length > MAX_PREGUNTA) {
        return error(`❌ La pregunta tiene que tener entre ${MIN_PREGUNTA} y ${MAX_PREGUNTA} caracteres.`);
    }
    const lista = (opciones || []).map((o) =>
        String(o ?? "")
            .replace(/\s+/g, " ")
            .trim(),
    );
    if (lista.some((o) => !o)) return error("❌ Ninguna opción puede estar vacía.");
    if (lista.length < MIN_OPCIONES) return error(`❌ Pon al menos ${MIN_OPCIONES} opciones.`);
    if (lista.length > MAX_OPCIONES) return error(`❌ Pon como mucho ${MAX_OPCIONES} opciones.`);
    if (lista.some((o) => o.length > MAX_OPCION)) return error(`❌ Cada opción puede tener como mucho ${MAX_OPCION} caracteres.`);
    if (new Set(lista.map((o) => o.toLowerCase())).size !== lista.length) return error("❌ Hay opciones repetidas.");
    return { ok: true, pregunta: texto, opciones: lista };
}

function leer(fila) {
    return fila ? { ...fila, opciones: JSON.parse(fila.opciones) } : null;
}

/** Una encuesta, o null. */
function obtener(id) {
    return leer(db.prepare("SELECT * FROM encuestas WHERE id = ?").get(Number(id)));
}

/**
 * Crea la encuesta (ya validada con validarEncuesta). `horas`: cuánto dura (24 por defecto).
 * @returns {{ ok: true, encuesta: object } | { ok: false, mensaje: string }}
 */
function crear({ guildId, channelId = null, creador, pregunta, opciones, horas = HORAS_POR_DEFECTO, ahora = Date.now() }) {
    const valida = validarEncuesta({ pregunta, opciones });
    if (!valida.ok) return valida;
    if (!Number.isFinite(horas) || horas < MIN_HORAS || horas > MAX_HORAS) {
        return error(`❌ La duración tiene que ser de ${MIN_HORAS} a ${MAX_HORAS} horas.`);
    }
    const { lastInsertRowid } = db
        .prepare(
            "INSERT INTO encuestas (guildId, channelId, creador, pregunta, opciones, creada_en, cierra_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
            String(guildId),
            channelId,
            String(creador),
            valida.pregunta,
            JSON.stringify(valida.opciones),
            ahora,
            ahora + horas * 3600 * 1000,
        );
    log.info(`Encuesta ${lastInsertRowid} creada por ${creador}: ${valida.pregunta}`);
    return { ok: true, encuesta: obtener(lastInsertRowid) };
}

/** Apunta dónde está el mensaje de la encuesta, para poder repintarlo al cerrarse. */
function guardarMensaje(id, channelId, messageId) {
    db.prepare("UPDATE encuestas SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, Number(id));
}

/** El recuento de cada opción (en el orden de la encuesta), el total de votos y el voto de `userId`, si lo ha dado. */
function recuento(id, userId = null) {
    const encuesta = obtener(id);
    const conteos = encuesta.opciones.map(() => 0);
    for (const f of db.prepare("SELECT opcion, COUNT(*) AS n FROM encuesta_votos WHERE encuesta_id = ? GROUP BY opcion").all(Number(id))) {
        if (conteos[f.opcion] !== undefined) conteos[f.opcion] = f.n;
    }
    const mio = userId
        ? db.prepare("SELECT opcion FROM encuesta_votos WHERE encuesta_id = ? AND userId = ?").get(Number(id), String(userId))
        : null;
    return { conteos, total: conteos.reduce((s, n) => s + n, 0), voto: mio ? mio.opcion : null };
}

/**
 * Vota la opción `opcion` (0, 1…). Una persona tiene un solo voto: votar otra opción reemplaza el anterior, sin duplicarlo.
 * @returns {{ ok: true, antes: number | null, encuesta: object } | { ok: false, mensaje: string }}
 */
function votar(id, userId, opcion, ahora = Date.now()) {
    const encuesta = obtener(id);
    if (!encuesta) return error("❌ Esa encuesta ya no existe.");
    if (encuesta.estado !== "abierta" || encuesta.cierra_en <= ahora) return error("🔒 Esta encuesta ya está cerrada.");
    if (!Number.isInteger(opcion) || !encuesta.opciones[opcion]) return error("❌ Esa opción no existe.");
    const antes = db.prepare("SELECT opcion FROM encuesta_votos WHERE encuesta_id = ? AND userId = ?").get(encuesta.id, String(userId));
    db.prepare(
        "INSERT INTO encuesta_votos (encuesta_id, userId, opcion, votado_en) VALUES (?, ?, ?, ?) ON CONFLICT(encuesta_id, userId) DO UPDATE SET opcion = excluded.opcion, votado_en = excluded.votado_en",
    ).run(encuesta.id, String(userId), opcion, ahora);
    return { ok: true, antes: antes ? antes.opcion : null, encuesta };
}

/** La cierra quien la creó (antes de que acabe su tiempo). */
function cerrar(id, userId, ahora = Date.now()) {
    const encuesta = obtener(id);
    if (!encuesta || encuesta.estado !== "abierta") return error("🔒 Esta encuesta ya está cerrada.");
    if (encuesta.creador !== String(userId)) return error("⛔ Solo quien creó la encuesta puede cerrarla.");
    db.prepare("UPDATE encuestas SET estado = 'cerrada', cerrada_en = ? WHERE id = ? AND estado = 'abierta'").run(ahora, encuesta.id);
    return { ok: true, encuesta: obtener(encuesta.id) };
}

/** Cierra las encuestas cuyo tiempo ha acabado (cron). @returns {object[]} las que se han cerrado ahora */
function cerrarVencidas(ahora = Date.now()) {
    const cerradas = [];
    for (const id of db.prepare("SELECT id FROM encuestas WHERE estado = 'abierta' AND cierra_en <= ?").pluck().all(ahora)) {
        const r = db.prepare("UPDATE encuestas SET estado = 'cerrada', cerrada_en = ? WHERE id = ? AND estado = 'abierta'").run(ahora, id);
        if (r.changes === 1) cerradas.push(obtener(id));
    }
    return cerradas;
}

module.exports = {
    MIN_OPCIONES,
    MAX_OPCIONES,
    MAX_PREGUNTA,
    MAX_OPCION,
    HORAS_POR_DEFECTO,
    MIN_HORAS,
    MAX_HORAS,
    validarEncuesta,
    obtener,
    crear,
    guardarMensaje,
    recuento,
    votar,
    cerrar,
    cerrarVencidas,
};
