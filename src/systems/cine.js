// 🎬 Sesión de cine (#24): `/cine peli hora` convoca a un grupo a ver algo a una hora (hora de Madrid). Quien quiere
// se apunta con un botón; el organizador (o un admin) puede cancelarla. 10 minutos antes se avisa en el canal a quien
// se ha apuntado. Ver paneles/cine.js y commands/general/cine.js.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Cine");
const ZONA = "Europe/Madrid";
const AVISO_MIN = 10;

const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/** Partes de una fecha en hora de Madrid. */
function partesMadrid(ms) {
    const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

/** Desfase de Madrid respecto a UTC en ese instante, en milisegundos (+2 h en verano). */
function desfaseMadrid(ms) {
    const p = partesMadrid(ms);
    const comoUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    return comoUtc - Math.floor(ms / 60000) * 60000;
}

/**
 * La próxima vez que son `texto` ("21:30") en hora de Madrid, a partir de `ahora`: hoy si aún no ha pasado, si no mañana.
 * @returns {number|null} milisegundos, o null si el texto no es una hora válida
 */
function proximaHora(texto, ahora = Date.now()) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(texto ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    const hoy = partesMadrid(ahora);
    for (const extra of [0, 1]) {
        const dia = new Date(Date.UTC(hoy.y, hoy.mo - 1, hoy.d + extra));
        const aproximado = Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h, mi);
        const inicio = aproximado - desfaseMadrid(aproximado);
        if (inicio > ahora) return inicio;
    }
    return null;
}

/** Crea la sesión y apunta al organizador. */
function crear({ guildId, canalId, organizador, peli, inicio }) {
    const { lastInsertRowid } = db
        .prepare("INSERT INTO cine_sesiones (guildId, canalId, organizador, peli, inicio, creada_en) VALUES (?, ?, ?, ?, ?, ?)")
        .run(String(guildId), String(canalId), String(organizador), peli, new Date(inicio).toISOString(), new Date().toISOString());
    apuntar(lastInsertRowid, organizador);
    return lastInsertRowid;
}

const sesion = (id) => db.prepare("SELECT * FROM cine_sesiones WHERE id = ?").get(Number(id)) || null;
const asistentes = (id) =>
    db
        .prepare("SELECT userId FROM cine_asistentes WHERE sesion_id = ? ORDER BY rowid")
        .all(Number(id))
        .map((r) => r.userId);
const guardarMensaje = (id, mensajeId) =>
    db.prepare("UPDATE cine_sesiones SET mensajeId = ? WHERE id = ?").run(String(mensajeId), Number(id));

function apuntar(id, userId) {
    db.prepare("INSERT OR IGNORE INTO cine_asistentes (sesion_id, userId) VALUES (?, ?)").run(Number(id), String(userId));
}
function salir(id, userId) {
    return db.prepare("DELETE FROM cine_asistentes WHERE sesion_id = ? AND userId = ?").run(Number(id), String(userId)).changes > 0;
}

/** Cancela la sesión. Solo el organizador o un admin (el que lo pide lo dice `esAdmin`). */
function cancelar(id, userId, esAdmin = false) {
    const s = sesion(id);
    if (!s || s.cancelada) return { ok: false, mensaje: "Esa sesión ya no está activa." };
    if (String(s.organizador) !== String(userId) && !esAdmin)
        return { ok: false, mensaje: "Solo quien la convocó o un admin puede cancelarla." };
    db.prepare("UPDATE cine_sesiones SET cancelada = 1 WHERE id = ?").run(Number(id));
    return { ok: true };
}

/** Sesiones que empiezan dentro de los próximos AVISO_MIN minutos y aún no tienen su recordatorio. */
function recordatoriosPendientes(ahora = Date.now()) {
    const hasta = new Date(ahora + AVISO_MIN * 60000).toISOString();
    return db
        .prepare(`SELECT * FROM cine_sesiones WHERE cancelada = 0 AND recordatorio = 0 AND inicio > ? AND inicio <= ?`)
        .all(new Date(ahora).toISOString(), hasta);
}

/** Manda el recordatorio de cada sesión en su canal, a quien se ha apuntado. Sin tocar la BD si el canal falla. */
async function enviarRecordatorios(client, ahora = Date.now()) {
    let enviados = 0;
    for (const s of recordatoriosPendientes(ahora)) {
        try {
            const canal = await client.channels.fetch(s.canalId);
            const personas = asistentes(s.id);
            const unix = Math.floor(new Date(s.inicio).getTime() / 1000);
            await canal.send({
                content: `🎬 Dentro de ${AVISO_MIN} minutos: **${s.peli}** (<t:${unix}:t>). ${personas.map((u) => `<@${u}>`).join(" ")}`,
                allowedMentions: { users: personas },
            });
            db.prepare("UPDATE cine_sesiones SET recordatorio = 1 WHERE id = ?").run(s.id);
            enviados++;
        } catch (e) {
            log.warn(`No se pudo mandar el recordatorio de la sesión ${s.id}: ${e.message}`);
        }
    }
    return enviados;
}

module.exports = {
    AVISO_MIN,
    proximaHora,
    crear,
    sesion,
    asistentes,
    guardarMensaje,
    apuntar,
    salir,
    cancelar,
    recordatoriosPendientes,
    enviarRecordatorios,
};
