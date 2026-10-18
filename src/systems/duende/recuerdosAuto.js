// 🧠 Recuerdos automáticos (#15): el Duende lee la conversación y, cuando algo merece recordarse de alguien (un gusto, un
// dato de su vida, una manía), lo propone como nota de su perfil. La propuesta llega por DM a los admins del servidor
// (alertas.admin_ids), con ✅ Guardar y ❌ Descartar. Nada se guarda sin que un admin lo apruebe.
// Para no gastar Gemini en cada mensaje: se mira a cada persona cada RONDA mensajes con texto de verdad (60 caracteres o
// más), en el canal del Duende si hay uno, y con un tope de llamadas por día y servidor. DUENDE_RECUERDOS_AUTO=0 lo apaga.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const perfiles = require("./perfiles");
const { generarConGemini } = require("../../services/duende/gemini");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Recuerdos");

const RONDA = 10;
const MIN_CARACTERES = 60;
const MAX_LLAMADAS_DIA = Number(process.env.DUENDE_RECUERDOS_MAX_DIA || 40);
const MAX_TEXTO = 200;
const DIAS_CADUCA = Number(process.env.DUENDE_RECUERDOS_CADUCA_DIAS || 7);

// Quien escribe menos de RONDA mensajes largos y se va dejaría su entrada para siempre: cada entrada guarda cuándo fue su
// último mensaje, las que llevan más de CADUCA_MS sin actividad se borran de vez en cuando, y hay un tope de entradas
// (se desaloja la menos reciente). Los Map conservan el orden de inserción: al actualizar una entrada se reinserta, y la
// más antigua es siempre la primera.
const CADUCA_MS = 60 * 60 * 1000;
const LIMPIEZA_MS = 10 * 60 * 1000;
const MAX_BUFFERS = 5000;
const buffers = new Map(); // "guild|user" -> { textos desde la última ronda, ultimo: ms del último mensaje }
const llamadasHoy = new Map(); // "guild|día" -> nº de llamadas

const activo = () => process.env.DUENDE_RECUERDOS_AUTO !== "0";
const diaActual = () => new Date().toISOString().slice(0, 10);

/** Cuenta una llamada a Gemini para el servidor hoy. @returns {boolean} false si ya se ha llegado al tope del día */
function puedeLlamar(guildId) {
    const clave = `${guildId}|${diaActual()}`;
    const n = llamadasHoy.get(clave) || 0;
    if (n >= MAX_LLAMADAS_DIA) return false;
    llamadasHoy.set(clave, n + 1);
    return true;
}

function instruccion(textos) {
    return [
        {
            text:
                "Lees mensajes de una persona en un chat de amigos. Decide si hay algo que merezca recordarse de ella a largo " +
                "plazo: un gusto, un dato de su vida, algo que le pasa, una manía o una opinión suya. Ignora los saludos, las " +
                "bromas del momento y lo que solo tiene sentido en esa conversación. Si hay algo, escríbelo en una frase corta " +
                'en tercera persona. Responde SOLO con JSON: {"recuerdo": "la frase"} o {"recuerdo": null} si no hay nada.',
        },
        { text: `Mensajes:\n${textos.map((t) => `- ${t}`).join("\n")}` },
    ];
}

/** El recuerdo que devuelve Gemini, o null (también si la respuesta no es JSON válido). */
function leerRecuerdo(respuesta) {
    try {
        const m = /\{[\s\S]*\}/.exec(String(respuesta || ""));
        const valor = m ? JSON.parse(m[0]).recuerdo : null;
        if (typeof valor !== "string") return null;
        const limpio = valor.trim().slice(0, MAX_TEXTO);
        return limpio.length >= 3 ? limpio : null;
    } catch {
        return null;
    }
}

/** Los admins que pueden aprobar recuerdos de ese servidor. */
function adminsDe(guildId) {
    return guildSettings.parseCsvIds(guildSettings.getSettings(guildId).alertas.admin_ids);
}

/**
 * Pregunta a Gemini por una persona y, si hay algo, lo guarda como propuesta. No avisa a nadie: devuelve la propuesta
 * para que el adaptador de Discord (src/discord/envios/recuerdos) mande los DMs.
 */
async function analizar(guildId, usuario, textos, deps = {}) {
    const gemini = deps.gemini || ((parts) => generarConGemini(parts, { maxTokens: 200, thinkingBudget: 0 }));
    const respuesta = await gemini(instruccion(textos));
    const texto = leerRecuerdo(respuesta);
    if (!texto) return null;
    const { lastInsertRowid } = db
        .prepare("INSERT INTO duende_recuerdos_propuestos (guildId, userId, nombre, texto, creada_en) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), String(usuario.id), usuario.nombre, texto, Date.now());
    const propuesta = { id: lastInsertRowid, guildId, userId: usuario.id, nombre: usuario.nombre, texto };
    log.info(`Recuerdo propuesto sobre ${usuario.nombre} (${guildId}): «${texto}»`);
    return propuesta;
}

/**
 * Mira un mensaje de una persona: acumula y, cada RONDA, pide a Gemini que decida. Se llama en cada mensaje del
 * servidor. Devuelve `null` si aún no toca, o una promesa con la propuesta (o null) si se ha llamado a Gemini, para
 * que el adaptador de Discord avise a los admins.
 */
function observar(message, deps = {}) {
    if (!activo() || !message.guildId || message.author?.bot) return null;
    const texto = String(message.content || "").trim();
    if (texto.length < MIN_CARACTERES) return null;
    const canalDuende = guildSettings.getSettings(message.guildId).duende?.allowed_channel_id;
    if (canalDuende && message.channelId !== canalDuende) return null;

    const clave = `${message.guildId}|${message.author.id}`;
    const ahora = deps.ahora ? deps.ahora() : Date.now();
    const textos = [...(buffers.get(clave)?.textos || []), texto].slice(-RONDA);
    if (textos.length < RONDA) {
        buffers.delete(clave); // se reinserta al final: así el orden del mapa es el de la última actividad
        buffers.set(clave, { textos, ultimo: ahora });
        if (buffers.size > MAX_BUFFERS) buffers.delete(buffers.keys().next().value);
        return null;
    }
    buffers.delete(clave);
    if (!puedeLlamar(message.guildId)) return null;
    const usuario = { id: message.author.id, nombre: message.member?.displayName || message.author.username };
    return analizar(message.guildId, usuario, textos, deps);
}

/**
 * ✅ / ❌ de un admin. Solo admins del servidor, y solo una vez por propuesta. Con `textoEditado` (✏️, #386) se guarda ese texto en
 * lugar del propuesto (y cuenta como aprobada); si es demasiado corto, se rechaza y la propuesta sigue pendiente.
 * @returns {{ ok: boolean, mensaje: string }}
 */
function resolver(id, adminId, aprobar, textoEditado = null) {
    const p = db
        .prepare("SELECT id, guildId, userId, nombre, texto, estado, creada_en, resuelta_por FROM duende_recuerdos_propuestos WHERE id = ?")
        .get(Number(id));
    if (!p) return { ok: false, mensaje: "Esa propuesta ya no existe." };
    if (!adminsDe(p.guildId).includes(String(adminId))) return { ok: false, mensaje: "Solo los admins del servidor pueden decidir esto." };
    if (p.estado === "caducado") return { ok: false, mensaje: "Esta propuesta caducó sin que nadie la decidiera." };
    if (p.estado !== "pendiente") return { ok: false, mensaje: `Ya está ${p.estado === "aprobado" ? "guardado" : "descartado"}.` };
    let texto = p.texto;
    if (textoEditado !== null) {
        texto = String(textoEditado).trim().slice(0, MAX_TEXTO);
        if (texto.length < 3) return { ok: false, mensaje: "El texto tiene que tener al menos 3 caracteres." };
    }
    const cambiados = db
        .prepare("UPDATE duende_recuerdos_propuestos SET estado = ?, resuelta_por = ? WHERE id = ? AND estado = 'pendiente'")
        .run(aprobar ? "aprobado" : "descartado", String(adminId), p.id).changes;
    if (cambiados === 0) return { ok: false, mensaje: "Otra persona acaba de decidirlo." };
    if (aprobar) perfiles.anotar({ id: p.userId, username: p.nombre }, texto, p.nombre);
    return { ok: true, mensaje: aprobar ? `🧠 Guardado en el perfil de ${p.nombre}.` : "❌ Descartado." };
}

/** Si ese admin puede decidir sobre esa propuesta (para abrirle el formulario de edición). */
function puedeDecidir(id, adminId) {
    const p = db.prepare("SELECT guildId, texto, estado FROM duende_recuerdos_propuestos WHERE id = ?").get(Number(id));
    if (!p) return { ok: false, mensaje: "Esa propuesta ya no existe." };
    if (!adminsDe(p.guildId).includes(String(adminId))) return { ok: false, mensaje: "Solo los admins del servidor pueden decidir esto." };
    if (p.estado === "caducado") return { ok: false, mensaje: "Esta propuesta caducó sin que nadie la decidiera." };
    if (p.estado !== "pendiente") return { ok: false, mensaje: `Ya está ${p.estado === "aprobado" ? "guardado" : "descartado"}.` };
    return { ok: true, texto: p.texto };
}

/**
 * Caduca las propuestas pendientes de más de DIAS_CADUCA días (#390): pasan a `caducado`. Devuelve los DMs que hay que
 * limpiar para que el adaptador de Discord les quite los botones; las ya decididas no cambian.
 * @returns {{ total: number, dms: Array<{ propuestaId: number, userId: string, mensajeId: string }> }}
 */
function caducarPendientes(ahora = Date.now()) {
    const limite = ahora - DIAS_CADUCA * 86400000;
    const caducadas = db.prepare("SELECT id FROM duende_recuerdos_propuestos WHERE estado = 'pendiente' AND creada_en < ?").all(limite);
    const dms = [];
    for (const { id } of caducadas) {
        const r = db.prepare("UPDATE duende_recuerdos_propuestos SET estado = 'caducado' WHERE id = ? AND estado = 'pendiente'").run(id);
        if (r.changes !== 1) continue;
        for (const dm of db.prepare("SELECT userId, mensajeId FROM duende_recuerdos_dms WHERE propuesta_id = ?").all(id)) {
            dms.push({ propuestaId: id, userId: dm.userId, mensajeId: dm.mensajeId });
        }
        db.prepare("DELETE FROM duende_recuerdos_dms WHERE propuesta_id = ?").run(id);
    }
    return { total: caducadas.length, dms };
}

/**
 * Borra los buffers de quien lleva más de una hora sin escribir. Como el mapa va de la actividad más antigua a la más
 * reciente, se para en cuanto encuentra uno que no ha caducado. @returns {number} entradas borradas
 */
function limpiar(ahora = Date.now()) {
    let borradas = 0;
    for (const [clave, entrada] of buffers) {
        if (ahora - entrada.ultimo <= CADUCA_MS) break;
        buffers.delete(clave);
        borradas++;
    }
    return borradas;
}
setInterval(() => limpiar(), LIMPIEZA_MS).unref();

/** Cuántas personas tienen mensajes acumulados esperando la siguiente ronda. */
const tamanoBuffers = () => buffers.size;

/** Olvida los buffers y los contadores del día (para los tests). */
function reiniciar() {
    buffers.clear();
    llamadasHoy.clear();
}

module.exports = {
    RONDA,
    MAX_LLAMADAS_DIA,
    MAX_BUFFERS,
    CADUCA_MS,
    observar,
    analizar,
    leerRecuerdo,
    resolver,
    puedeDecidir,
    adminsDe,
    caducarPendientes,
    DIAS_CADUCA,
    limpiar,
    tamanoBuffers,
    reiniciar,
};
