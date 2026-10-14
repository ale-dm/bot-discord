// ⏰ Recordatorios personales (/recordar, #320): cada persona se deja un aviso con un texto (hasta 200 caracteres) y una hora ("18:30"
// de hoy o de mañana, "mañana 09:00" o "en 45 min", hasta 24 h) y el bot se lo manda por DM. Hasta 10 pendientes por persona. Un
// cron de un minuto envía los vencidos; si el DM está cerrado, el aviso se pierde y se anota en el log (no se reintenta).
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const { momentoMadrid, fechaMadridAMs, sumarDias } = require("../core/zonaMadrid");
const { sendDm } = require("./avisosDm");

const log = createLogger("Recordatorios");

const MAX_ACTIVOS = 10;
const TEXTO_MAX = 200;
const MAX_MS = 24 * 3600000;

/**
 * Cuándo es lo que ha escrito alguien, en ms: «18:30» (hoy si todavía no ha pasado; si ya pasó, mañana), «mañana 09:00», «hoy 20:15»,
 * «en 45 min», «en 2 h» o «dentro de 90 minutos». @returns {{ ok: true, cuando: number } | { ok: false, mensaje: string }}
 */
function parsearCuando(texto, ahora = Date.now()) {
    const t = String(texto || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const relativo = /^(?:en|dentro de) (\d{1,4}) ?(m|min|mins|minuto|minutos|h|hora|horas)$/.exec(t);
    if (relativo) {
        const n = Number(relativo[1]);
        const ms = n * (relativo[2].startsWith("h") ? 3600000 : 60000);
        if (n < 1) return { ok: false, mensaje: "❌ Tiene que ser al menos 1 minuto." };
        if (ms > MAX_MS) return { ok: false, mensaje: "❌ «Dentro de…» llega hasta 24 horas." };
        return { ok: true, cuando: ahora + ms };
    }
    const hora = /^(hoy |mañana |manana )?(\d{1,2})[:.](\d{2})$/.exec(t);
    if (!hora) return { ok: false, mensaje: "❌ No entiendo la hora. Prueba con `18:30`, `mañana 09:00` o `en 45 min`." };
    const [, dia, h, m] = hora;
    if (Number(h) > 23 || Number(m) > 59) return { ok: false, mensaje: "❌ Esa hora no existe." };
    const hoy = momentoMadrid(ahora).dia;
    const aMs = (fecha) => {
        const [a, mes, d] = fecha.split("-");
        return fechaMadridAMs(`${d}/${mes}/${a} ${h}:${m}`);
    };
    let fecha = dia?.startsWith("ma") ? sumarDias(hoy, 1) : hoy;
    let cuando = aMs(fecha);
    if (cuando <= ahora) {
        if (dia) return { ok: false, mensaje: "❌ Esa hora de hoy ya ha pasado." };
        fecha = sumarDias(hoy, 1);
        cuando = aMs(fecha);
    }
    if (cuando - ahora > MAX_MS)
        return { ok: false, mensaje: "❌ Solo puedo recordarte algo de hoy o de mañana, hasta dentro de 24 horas." };
    return { ok: true, cuando };
}

/** Crea un recordatorio. @returns {{ ok: boolean, mensaje: string, cuando?: number }} */
function crear(userId, textoCuando, texto, ahora = Date.now()) {
    const aviso = String(texto || "").trim();
    if (!aviso) return { ok: false, mensaje: "❌ Escribe qué quieres que te recuerde." };
    if (aviso.length > TEXTO_MAX) return { ok: false, mensaje: `❌ Como mucho ${TEXTO_MAX} caracteres.` };
    const c = parsearCuando(textoCuando, ahora);
    if (!c.ok) return c;
    if (pendientes(userId).length >= MAX_ACTIVOS)
        return { ok: false, mensaje: `❌ Ya tienes ${MAX_ACTIVOS} recordatorios pendientes. Borra alguno.` };
    db.prepare("INSERT INTO recordatorios_personales (userId, texto, cuando, enviado, creado) VALUES (?, ?, ?, 0, ?)").run(
        String(userId),
        aviso,
        c.cuando,
        ahora,
    );
    return {
        ok: true,
        cuando: c.cuando,
        mensaje: `⏰ Te lo recordaré <t:${Math.floor(c.cuando / 1000)}:f> (<t:${Math.floor(c.cuando / 1000)}:R>).`,
    };
}

/** Los pendientes de alguien, por hora. */
function pendientes(userId) {
    return db
        .prepare("SELECT id, texto, cuando FROM recordatorios_personales WHERE userId = ? AND enviado = 0 ORDER BY cuando")
        .all(String(userId));
}

/** Borra un recordatorio propio y pendiente. */
function borrar(userId, id) {
    return (
        db.prepare("DELETE FROM recordatorios_personales WHERE id = ? AND userId = ? AND enviado = 0").run(id, String(userId)).changes === 1
    );
}

/** Cron (cada minuto): manda por DM los que ya tocan. Cada uno se marca antes de enviarse: no se reintenta. @returns {Promise<number>} DMs enviados */
async function enviarVencidos(client, ahora = Date.now()) {
    let enviados = 0;
    for (const r of db
        .prepare("SELECT id, userId, texto FROM recordatorios_personales WHERE enviado = 0 AND cuando <= ? ORDER BY cuando")
        .all(ahora)) {
        if (db.prepare("UPDATE recordatorios_personales SET enviado = 1 WHERE id = ? AND enviado = 0").run(r.id).changes !== 1) continue;
        if (await sendDm(client, r.userId, { content: `⏰ **Recordatorio:** ${r.texto}`, allowedMentions: { parse: [] } })) enviados++;
        else log.warn(`No se pudo mandar el recordatorio #${r.id} a ${r.userId} (DMs cerrados): se pierde`);
    }
    return enviados;
}

module.exports = { MAX_ACTIVOS, TEXTO_MAX, parsearCuando, crear, pendientes, borrar, enviarVencidos };
