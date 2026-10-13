// 💡 Buzón de sugerencias (#428): cada idea se publica en el canal configurado (sugerencias.canal_id) con su número y botones
// 👍 y 👎; cada persona tiene un voto y puede cambiarlo. Un admin la marca como aceptada o descartada (con un motivo opcional) y
// quien la envió recibe el resultado por DM. Hasta tres sugerencias por persona cada 24 horas; no hay sugerencias anónimas.
// Sin nada de Discord: el formulario y los botones están en commands/general/sugerencia.js y paneles/sugerencia.js.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Sugerencias");

const MIN_TEXTO = 5;
const MAX_TEXTO = 1000;
const MAX_MOTIVO = 300;
/** Sugerencias que puede enviar una persona en 24 horas. */
const MAX_POR_DIA = 3;
const DIA_MS = 24 * 3600 * 1000;
const ESTADOS = { pendiente: "🕒 Pendiente", aceptada: "✅ Aceptada", descartada: "❌ Descartada" };

const error = (mensaje) => ({ ok: false, mensaje });

/** La sugerencia limpia (espacios y saltos de línea repetidos fuera) o el error de longitud. */
function validarTexto(texto) {
    const t = String(texto ?? "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (t.length < MIN_TEXTO) return error(`❌ Cuéntame un poco más: la sugerencia tiene que tener al menos ${MIN_TEXTO} caracteres.`);
    if (t.length > MAX_TEXTO) return error(`❌ La sugerencia puede tener como mucho ${MAX_TEXTO} caracteres (has puesto ${t.length}).`);
    return { ok: true, texto: t };
}

/** Cuántas ha enviado alguien en las últimas 24 horas. */
function enviadasRecientes(userId, ahora = Date.now()) {
    return db.prepare("SELECT COUNT(*) AS n FROM sugerencias WHERE userId = ? AND creada_en > ?").get(String(userId), ahora - DIA_MS).n;
}

/** Una sugerencia, o null. */
function obtener(id) {
    return db.prepare("SELECT * FROM sugerencias WHERE id = ?").get(Number(id)) || null;
}

/** Crea una sugerencia pendiente, si la persona no ha llegado a su tope diario. @returns {{ ok: true, sugerencia: object } | { ok: false, mensaje: string }} */
function crear({ guildId, userId, texto, ahora = Date.now() }) {
    const valida = validarTexto(texto);
    if (!valida.ok) return valida;
    if (enviadasRecientes(userId, ahora) >= MAX_POR_DIA) {
        return error(`❌ Ya has enviado ${MAX_POR_DIA} sugerencias en las últimas 24 horas: espera un poco para mandar otra.`);
    }
    const { lastInsertRowid } = db
        .prepare("INSERT INTO sugerencias (guildId, userId, texto, creada_en) VALUES (?, ?, ?, ?)")
        .run(String(guildId), String(userId), valida.texto, ahora);
    log.info(`Sugerencia ${lastInsertRowid} de ${userId}`);
    return { ok: true, sugerencia: obtener(lastInsertRowid) };
}

/** Borra una sugerencia que no se llegó a publicar (y sus votos). */
function eliminar(id) {
    db.prepare("DELETE FROM sugerencia_votos WHERE sugerencia_id = ?").run(Number(id));
    return db.prepare("DELETE FROM sugerencias WHERE id = ?").run(Number(id)).changes === 1;
}

/** Apunta dónde se ha publicado la sugerencia, para poder repintar su marcador y su estado. */
function guardarMensaje(id, channelId, messageId) {
    db.prepare("UPDATE sugerencias SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, Number(id));
}

/** Los 👍 y los 👎 de una sugerencia y el voto de `userId` (1, -1 o null). */
function marcador(id, userId = null) {
    const f = db
        .prepare(
            "SELECT COALESCE(SUM(voto = 1), 0) AS favor, COALESCE(SUM(voto = -1), 0) AS contra FROM sugerencia_votos WHERE sugerencia_id = ?",
        )
        .get(Number(id));
    const mio = userId
        ? db.prepare("SELECT voto FROM sugerencia_votos WHERE sugerencia_id = ? AND userId = ?").get(Number(id), String(userId))
        : null;
    return { favor: f.favor, contra: f.contra, voto: mio ? mio.voto : null };
}

/**
 * Vota 👍 (`1`) o 👎 (`-1`). Un solo voto por persona: votar lo contrario lo cambia, y repetir el mismo lo deja como está.
 * Una sugerencia ya resuelta no admite votos.
 * @returns {{ ok: true, cambio: boolean, sugerencia: object } | { ok: false, mensaje: string }}
 */
function votar(id, userId, voto, ahora = Date.now()) {
    const s = obtener(id);
    if (!s) return error("❌ Esa sugerencia ya no existe.");
    if (s.estado !== "pendiente") return error("🔒 Esta sugerencia ya está resuelta: no admite más votos.");
    if (voto !== 1 && voto !== -1) return error("❌ Ese voto no existe.");
    const antes = db.prepare("SELECT voto FROM sugerencia_votos WHERE sugerencia_id = ? AND userId = ?").get(s.id, String(userId));
    db.prepare(
        "INSERT INTO sugerencia_votos (sugerencia_id, userId, voto, votado_en) VALUES (?, ?, ?, ?) ON CONFLICT(sugerencia_id, userId) DO UPDATE SET voto = excluded.voto, votado_en = excluded.votado_en",
    ).run(s.id, String(userId), voto, ahora);
    return { ok: true, cambio: Boolean(antes) && antes.voto !== voto, sugerencia: s };
}

/**
 * Un admin marca la sugerencia como aceptada o descartada. Quién puede hacerlo lo comprueba quien llama (isAdmin).
 * @returns {{ ok: true, sugerencia: object } | { ok: false, mensaje: string }}
 */
function resolver(id, estado, adminId, motivo = "", ahora = Date.now()) {
    if (!["aceptada", "descartada"].includes(estado)) return error("❌ Ese estado no existe.");
    const s = obtener(id);
    if (!s) return error("❌ Esa sugerencia ya no existe.");
    const texto = String(motivo ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (texto.length > MAX_MOTIVO) return error(`❌ El motivo puede tener como mucho ${MAX_MOTIVO} caracteres.`);
    const r = db
        .prepare("UPDATE sugerencias SET estado = ?, motivo = ?, resuelta_en = ?, resuelta_por = ? WHERE id = ? AND estado = 'pendiente'")
        .run(estado, texto || null, ahora, String(adminId), s.id);
    if (r.changes !== 1) return error(`Esta sugerencia ya está ${s.estado}.`);
    return { ok: true, sugerencia: obtener(s.id) };
}

/** Las sugerencias pendientes de un servidor, de la más antigua a la más reciente. */
function pendientes(guildId, limite = 25) {
    return db
        .prepare("SELECT * FROM sugerencias WHERE guildId = ? AND estado = 'pendiente' ORDER BY id LIMIT ?")
        .all(String(guildId), limite);
}

module.exports = {
    ESTADOS,
    MIN_TEXTO,
    MAX_TEXTO,
    MAX_MOTIVO,
    MAX_POR_DIA,
    validarTexto,
    enviadasRecientes,
    obtener,
    crear,
    eliminar,
    guardarMensaje,
    marcador,
    votar,
    resolver,
    pendientes,
};
