// 🎫 Tickets de soporte (#537): un hilo privado entre quien lo abre y el staff, en el canal de tickets. Uno abierto por
// persona y, tras cerrarlo, una hora de espera para abrir otro. Al cerrarse queda quién lo cerró y cuándo, y la
// transcripción va al canal de logs (systems/ticketsTranscripcion). Sin nada de Discord: los hilos, los permisos y los
// envíos están en discord/envios/tickets.js; los mensajes, en paneles/tickets.js; los botones, en paneles/ticketsAcciones.js.
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const { createLogger } = require("../core/logger");

const log = createLogger("Tickets");

/** Espera tras cerrar un ticket para poder abrir otro. */
const ESPERA_MS = 3600 * 1000;
const CATEGORIA_DEFECTO = "General";
const MAX_CATEGORIAS = 10;
const MAX_CATEGORIA = 40;
const MIN_ASUNTO = 5;
const MAX_ASUNTO = 1000;
/** Un ticket sin hilo pasado este tiempo es una apertura que se cortó a medias (reinicio, error): no bloquea. */
const SIN_HILO_MS = 5 * 60 * 1000;

/** Lo que necesita el bot en el canal de tickets para crear y cerrar los hilos privados, y en el de logs para la transcripción. */
const PERMISOS_HILOS = ["ViewChannel", "SendMessages", "EmbedLinks", "CreatePrivateThreads", "SendMessagesInThreads", "ManageThreads"];
const PERMISOS_LOGS = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles"];
const NOMBRES_PERMISOS = {
    ViewChannel: "Ver canal",
    SendMessages: "Enviar mensajes",
    EmbedLinks: "Insertar enlaces",
    AttachFiles: "Adjuntar archivos",
    CreatePrivateThreads: "Crear hilos privados",
    SendMessagesInThreads: "Enviar mensajes en hilos",
    ManageThreads: "Gestionar hilos",
    MentionEveryone: "Mencionar @everyone, @here y todos los roles",
};

const error = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

/** Los permisos en el español de Discord, separados por comas. */
const describirPermisos = (lista) => lista.map((p) => `«${NOMBRES_PERMISOS[p] || p}»`).join(", ");

/** Una duración en minutos (o «menos de un minuto»), para los avisos de espera. */
function formatoEspera(ms) {
    const minutos = Math.ceil(ms / 60000);
    if (minutos <= 1) return "1 minuto";
    return `${minutos} minutos`;
}

/**
 * Las categorías escritas por un admin (una por línea o separadas por comas): sin espacios de más ni repetidas.
 * Vacío = solo «General». @returns {{ ok: true, categorias: string[] } | { ok: false, motivo: string }}
 */
function normalizarCategorias(texto) {
    const vistas = new Set();
    const categorias = [];
    for (const trozo of String(texto ?? "").split(/[\n,]/)) {
        const c = trozo.replace(/\s+/g, " ").trim();
        if (!c || vistas.has(c.toLowerCase())) continue;
        if (c.length > MAX_CATEGORIA)
            return error(`❌ «${c.slice(0, 20)}…» es muy larga: cada categoría, ${MAX_CATEGORIA} caracteres como mucho.`);
        vistas.add(c.toLowerCase());
        categorias.push(c);
    }
    if (categorias.length > MAX_CATEGORIAS) return error(`❌ Como mucho ${MAX_CATEGORIAS} categorías (has puesto ${categorias.length}).`);
    return { ok: true, categorias: categorias.length ? categorias : [CATEGORIA_DEFECTO] };
}

/** La configuración de tickets de un servidor y lo que le falta para funcionar (`falta` vacío = lista). */
function configuracion(guildId) {
    const t = guildSettings.getSettings(guildId).tickets;
    const cat = normalizarCategorias(t.categorias);
    const falta = [];
    if (!t.canal_id) falta.push("el canal de tickets");
    if (!t.rol_staff) falta.push("el rol de staff");
    if (!t.canal_logs) falta.push("el canal de transcripciones");
    return {
        canalId: t.canal_id,
        rolStaff: t.rol_staff,
        canalLogs: t.canal_logs,
        categorias: cat.ok ? cat.categorias : [CATEGORIA_DEFECTO],
        falta,
        lista: falta.length === 0,
    };
}

function porId(id) {
    return db.prepare("SELECT * FROM tickets WHERE id = ?").get(Number(id)) || null;
}

/** El ticket abierto de una persona en el servidor, o null. */
function abiertoDe(guildId, userId) {
    return (
        db.prepare("SELECT * FROM tickets WHERE guildId = ? AND autorId = ? AND estado = 'abierto'").get(String(guildId), String(userId)) ||
        null
    );
}

/** Lo que le queda de espera a alguien para abrir otro ticket (0 si puede ya). Solo cuentan los cerrados de verdad. */
function esperaRestante(guildId, userId, ahora = Date.now()) {
    const f = db
        .prepare("SELECT MAX(cerradoEn) AS ultimo FROM tickets WHERE guildId = ? AND autorId = ? AND estado = 'cerrado'")
        .get(String(guildId), String(userId));
    if (!f || !f.ultimo) return 0;
    return Math.max(0, f.ultimo + ESPERA_MS - ahora);
}

/** ¿Es una apertura que se quedó a medias (sin hilo y ya vieja)? */
const aMedias = (ticket, ahora = Date.now()) => !ticket.threadId && ahora - ticket.abiertoEn > SIN_HILO_MS;

/**
 * Si alguien puede abrir un ticket ahora. Con uno abierto devuelve `ticket` para enlazarlo.
 * @returns {{ ok: true, config: object } | { ok: false, motivo: string, ticket?: object }}
 */
function comprobarApertura(guildId, userId, ahora = Date.now()) {
    const config = configuracion(guildId);
    if (!config.lista) return error("🛠️ Los tickets no están configurados todavía: avisa a un admin.");
    const abierto = abiertoDe(guildId, userId);
    if (abierto && aMedias(abierto, ahora)) marcarPerdido(abierto.id, ahora);
    else if (abierto) {
        const donde = abierto.threadId ? `: <#${abierto.threadId}>` : " (se está creando ahora mismo)";
        return error(`📌 Ya tienes un ticket abierto${donde}. Ciérralo antes de abrir otro.`, { ticket: abierto });
    }
    const espera = esperaRestante(guildId, userId, ahora);
    if (espera > 0) return error(`⏳ Acabas de cerrar un ticket: podrás abrir otro dentro de ${formatoEspera(espera)}.`);
    return { ok: true, config };
}

/** El asunto limpio (espacios repetidos fuera) o el error de longitud. */
function validarAsunto(texto) {
    const t = String(texto ?? "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (t.length < MIN_ASUNTO) return error(`❌ Cuéntanos un poco más: al menos ${MIN_ASUNTO} caracteres.`);
    if (t.length > MAX_ASUNTO) return error(`❌ Como mucho ${MAX_ASUNTO} caracteres (has puesto ${t.length}).`);
    return { ok: true, texto: t };
}

/**
 * Reserva un ticket abierto (todavía sin hilo). Comprueba la categoría, el asunto, el límite de uno abierto y la espera.
 * @returns {{ ok: true, ticket: object, config: object } | { ok: false, motivo: string, ticket?: object }}
 */
function abrir({ guildId, autorId, categoria, asunto, ahora = Date.now() }) {
    const puede = comprobarApertura(guildId, autorId, ahora);
    if (!puede.ok) return puede;
    const cat = puede.config.categorias.find((c) => c.toLowerCase() === String(categoria ?? "").toLowerCase());
    if (!cat) return error("❌ Esa categoría ya no existe: vuelve a abrir el formulario.");
    const valido = validarAsunto(asunto);
    if (!valido.ok) return valido;
    try {
        const { lastInsertRowid } = db
            .prepare("INSERT INTO tickets (guildId, autorId, categoria, asunto, abiertoEn) VALUES (?, ?, ?, ?, ?)")
            .run(String(guildId), String(autorId), cat, valido.texto, ahora);
        log.info(`Ticket ${lastInsertRowid} abierto por ${autorId} (${cat})`);
        return { ok: true, ticket: porId(lastInsertRowid), config: puede.config };
    } catch (e) {
        // El índice único: otro clic a la vez ya lo abrió.
        if (String(e.code).startsWith("SQLITE_CONSTRAINT")) return error("📌 Ya tienes un ticket abierto. Ciérralo antes de abrir otro.");
        throw e;
    }
}

/** Apunta el hilo y el mensaje de bienvenida del ticket. */
function guardarHilo(id, threadId, mensajeId = null) {
    db.prepare("UPDATE tickets SET threadId = ?, mensajeId = ? WHERE id = ?").run(
        String(threadId),
        mensajeId ? String(mensajeId) : null,
        Number(id),
    );
    return porId(id);
}

/** Borra un ticket cuyo hilo no se llegó a crear: no cuenta como abierto ni para la espera. */
function descartar(id) {
    return db.prepare("DELETE FROM tickets WHERE id = ? AND estado = 'abierto'").run(Number(id)).changes === 1;
}

/** Cierra un ticket abierto. Solo uno de dos cierres a la vez gana. @returns {{ ok: true, ticket } | { ok: false, motivo }} */
function cerrar(id, actorId, ahora = Date.now()) {
    const r = db
        .prepare("UPDATE tickets SET estado = 'cerrado', cerradoEn = ?, cerradoPor = ? WHERE id = ? AND estado = 'abierto'")
        .run(ahora, String(actorId), Number(id));
    if (r.changes !== 1) return error("🔒 Este ticket ya está cerrado.");
    log.info(`Ticket ${id} cerrado por ${actorId}`);
    return { ok: true, ticket: porId(id) };
}

/** El hilo de un ticket abierto ya no existe: se da por perdido (no cuenta para la espera). */
function marcarPerdido(id, ahora = Date.now()) {
    const r = db.prepare("UPDATE tickets SET estado = 'perdido', cerradoEn = ? WHERE id = ? AND estado = 'abierto'").run(ahora, Number(id));
    if (r.changes === 1) log.warn(`Ticket ${id} sin hilo: se da por perdido`);
    return r.changes === 1;
}

/** Los tickets abiertos del servidor, del más antiguo al más nuevo. */
function abiertos(guildId, limite = 25) {
    return db
        .prepare("SELECT * FROM tickets WHERE guildId = ? AND estado = 'abierto' ORDER BY abiertoEn LIMIT ?")
        .all(String(guildId), limite);
}

function cuentaAbiertos(guildId) {
    return db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guildId = ? AND estado = 'abierto'").get(String(guildId)).n;
}

/** Pueden cerrar un ticket quien lo abrió y el staff. */
const puedeCerrar = (ticket, { userId, esStaff }) => !!esStaff || String(ticket.autorId) === String(userId);

module.exports = {
    ESPERA_MS,
    CATEGORIA_DEFECTO,
    MAX_CATEGORIAS,
    MAX_CATEGORIA,
    MIN_ASUNTO,
    MAX_ASUNTO,
    SIN_HILO_MS,
    PERMISOS_HILOS,
    PERMISOS_LOGS,
    describirPermisos,
    formatoEspera,
    normalizarCategorias,
    configuracion,
    porId,
    abiertoDe,
    esperaRestante,
    comprobarApertura,
    validarAsunto,
    abrir,
    guardarHilo,
    descartar,
    cerrar,
    marcarPerdido,
    abiertos,
    cuentaAbiertos,
    puedeCerrar,
};
