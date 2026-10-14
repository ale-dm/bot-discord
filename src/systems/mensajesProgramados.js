// ✉️ /mensaje programado (#424): el DM que un admin deja para una fecha y hora (Madrid). Se guarda en `mensajes_programados`
// hasta que sale (cron cada 5 minutos, así que con un margen de 5) o se cancela. El texto se borra en cuanto el mensaje se
// envía, se cancela o falla, y no se copia nunca en la auditoría. Si el bot estaba apagado a la hora, sale al arrancar con un
// aviso de que llega tarde.
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const { sendDm } = require("./avisosDm");
const { momentoMadrid } = require("../core/zonaMadrid");

const log = createLogger("MensajeProgramado");

const MARGEN_TARDE_MS = 10 * 60 * 1000; // más de esto después de la hora → el aviso de que llega tarde
const MAX_PENDIENTES = 20;
const MAX_ANTELACION_MS = 365 * 24 * 60 * 60 * 1000;

function programar({ guildId, autorId, destinoId, destinoNombre, texto, enviarEn }, ahora = Date.now()) {
    if (!(enviarEn > ahora)) return { ok: false, motivo: "La fecha ya ha pasado." };
    if (enviarEn - ahora > MAX_ANTELACION_MS) return { ok: false, motivo: "No se puede programar con más de un año de antelación." };
    if (listarPendientes(guildId).length >= MAX_PENDIENTES) return { ok: false, motivo: `Ya hay ${MAX_PENDIENTES} mensajes pendientes.` };
    const r = db
        .prepare(
            `INSERT INTO mensajes_programados (guildId, autorId, destinoId, destinoNombre, texto, enviar_en, creado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(String(guildId), String(autorId), String(destinoId), destinoNombre || null, texto, enviarEn, ahora);
    return { ok: true, id: Number(r.lastInsertRowid) };
}

/** Los pendientes del servidor por orden de salida (sin el texto: quien lista solo ve a quién, cuándo y cuántos caracteres). */
function listarPendientes(guildId) {
    return db
        .prepare(
            `SELECT id, autorId, destinoId, destinoNombre, enviar_en AS enviarEn, LENGTH(texto) AS caracteres
             FROM mensajes_programados WHERE guildId = ? AND estado = 'pendiente' ORDER BY enviar_en, id`,
        )
        .all(String(guildId));
}

/** Cancela un pendiente del servidor y borra su texto. @returns {{ id, destinoId, caracteres } | null} null si no estaba pendiente */
function cancelar(id, guildId, ahora = Date.now()) {
    const fila = listarPendientes(guildId).find((m) => m.id === Number(id));
    if (!fila) return null;
    db.prepare("UPDATE mensajes_programados SET estado = 'cancelado', texto = NULL, cerrado_en = ? WHERE id = ?").run(ahora, fila.id);
    return { id: fila.id, destinoId: fila.destinoId, caracteres: fila.caracteres };
}

function textoDeSalida(m, ahora) {
    if (ahora - m.enviar_en <= MARGEN_TARDE_MS) return m.texto;
    const { dia, hora, minuto } = momentoMadrid(m.enviar_en);
    const [a, mes, d] = dia.split("-");
    const cuando = `${d}/${mes}/${a} a las ${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
    return `⏰ _Este mensaje debía llegarte el ${cuando}; el bot estaba apagado y sale ahora._\n\n${m.texto}`;
}

/** Manda los pendientes cuya hora ya llegó. @returns {Promise<{ enviados: number, fallidos: number }>} */
async function enviarVencidos(client, ahora = Date.now()) {
    const vencidos = db
        .prepare("SELECT * FROM mensajes_programados WHERE estado = 'pendiente' AND enviar_en <= ? ORDER BY enviar_en, id")
        .all(ahora);
    const cierre = db.prepare(
        "UPDATE mensajes_programados SET estado = ?, texto = NULL, cerrado_en = ? WHERE id = ? AND estado = 'pendiente'",
    );
    let enviados = 0;
    let fallidos = 0;
    for (const m of vencidos) {
        const ok = await sendDm(client, m.destinoId, { content: textoDeSalida(m, ahora) });
        cierre.run(ok ? "enviado" : "fallido", Date.now(), m.id);
        if (ok) enviados++;
        else {
            fallidos++;
            log.warn(`No se pudo enviar el mensaje programado #${m.id} a ${m.destinoId} (¿DMs cerrados?)`);
        }
    }
    return { enviados, fallidos };
}

module.exports = { programar, listarPendientes, cancelar, enviarVencidos, MAX_PENDIENTES };
