// 🧠 Recuerdos automáticos (#15): el Duende lee la conversación y, cuando algo merece recordarse de alguien (un gusto, un
// dato de su vida, una manía), lo propone como nota de su perfil. La propuesta llega por DM a los admins del servidor
// (alertas.admin_ids), con ✅ Guardar y ❌ Descartar. Nada se guarda sin que un admin lo apruebe.
// Para no gastar Gemini en cada mensaje: se mira a cada persona cada RONDA mensajes con texto de verdad (60 caracteres o
// más), en el canal del Duende si hay uno, y con un tope de llamadas por día y servidor. DUENDE_RECUERDOS_AUTO=0 lo apaga.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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

const buffers = new Map(); // "guild|user" -> textos desde la última ronda
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

/** Pregunta a Gemini por una persona y, si hay algo, lo guarda como propuesta y avisa a los admins. */
async function analizar(client, guildId, usuario, textos, deps = {}) {
    const gemini = deps.gemini || ((parts) => generarConGemini(parts, { maxTokens: 200, thinkingBudget: 0 }));
    const respuesta = await gemini(instruccion(textos));
    const texto = leerRecuerdo(respuesta);
    if (!texto) return null;
    const { lastInsertRowid } = db
        .prepare("INSERT INTO duende_recuerdos_propuestos (guildId, userId, nombre, texto, creada_en) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), String(usuario.id), usuario.nombre, texto, Date.now());
    const propuesta = { id: lastInsertRowid, guildId, userId: usuario.id, nombre: usuario.nombre, texto };
    await avisarAdmins(client, propuesta);
    log.info(`Recuerdo propuesto sobre ${usuario.nombre} (${guildId}): «${texto}»`);
    return propuesta;
}

/** Un DM a cada admin con la propuesta y los dos botones. Un admin que tiene los DMs cerrados no para a los demás. */
async function avisarAdmins(client, propuesta) {
    const embed = new EmbedBuilder()
        .setTitle("🧠 Recuerdo propuesto")
        .setDescription(`Sobre <@${propuesta.userId}>: «${propuesta.texto}»\n\n¿Lo guardo en su perfil del Duende?`)
        .setColor(0x9b59b6);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`recuerdo_auto_ok_${propuesta.id}`).setLabel("✅ Guardar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`recuerdo_auto_no_${propuesta.id}`).setLabel("❌ Descartar").setStyle(ButtonStyle.Danger),
    );
    for (const adminId of adminsDe(propuesta.guildId)) {
        try {
            const usuario = await client.users.fetch(adminId);
            await usuario.send({ embeds: [embed], components: [fila], allowedMentions: { parse: [] } });
        } catch (e) {
            log.debug(`No se pudo avisar a ${adminId} del recuerdo propuesto: ${e.message}`);
        }
    }
}

/**
 * Mira un mensaje de una persona: acumula y, cada RONDA, pide a Gemini que decida. Se llama en cada mensaje del servidor;
 * no bloquea nada (la llamada a Gemini va en segundo plano).
 */
function observar(message, deps = {}) {
    if (!activo() || !message.guildId || message.author?.bot) return;
    const texto = String(message.content || "").trim();
    if (texto.length < MIN_CARACTERES) return;
    const canalDuende = guildSettings.getSettings(message.guildId).duende?.allowed_channel_id;
    if (canalDuende && message.channelId !== canalDuende) return;

    const clave = `${message.guildId}|${message.author.id}`;
    const textos = [...(buffers.get(clave) || []), texto].slice(-RONDA);
    if (textos.length < RONDA) {
        buffers.set(clave, textos);
        return;
    }
    buffers.delete(clave);
    if (!puedeLlamar(message.guildId)) return;
    const usuario = { id: message.author.id, nombre: message.member?.displayName || message.author.username };
    analizar(message.client, message.guildId, usuario, textos, deps).catch((e) =>
        log.warn(`No se pudo analizar la conversación de ${usuario.nombre}: ${e.message}`),
    );
}

/**
 * ✅ / ❌ de un admin. Solo admins del servidor, y solo una vez por propuesta.
 * @returns {{ ok: boolean, mensaje: string }}
 */
function resolver(id, adminId, aprobar) {
    const p = db
        .prepare("SELECT id, guildId, userId, nombre, texto, estado, creada_en, resuelta_por FROM duende_recuerdos_propuestos WHERE id = ?")
        .get(Number(id));
    if (!p) return { ok: false, mensaje: "Esa propuesta ya no existe." };
    if (!adminsDe(p.guildId).includes(String(adminId))) return { ok: false, mensaje: "Solo los admins del servidor pueden decidir esto." };
    if (p.estado !== "pendiente") return { ok: false, mensaje: `Ya está ${p.estado === "aprobado" ? "guardado" : "descartado"}.` };
    const cambiados = db
        .prepare("UPDATE duende_recuerdos_propuestos SET estado = ?, resuelta_por = ? WHERE id = ? AND estado = 'pendiente'")
        .run(aprobar ? "aprobado" : "descartado", String(adminId), p.id).changes;
    if (cambiados === 0) return { ok: false, mensaje: "Otra persona acaba de decidirlo." };
    if (aprobar) perfiles.anotar({ id: p.userId, username: p.nombre }, p.texto, p.nombre);
    return { ok: true, mensaje: aprobar ? `🧠 Guardado en el perfil de ${p.nombre}.` : "❌ Descartado." };
}

/** Olvida los buffers y los contadores del día (para los tests). */
function reiniciar() {
    buffers.clear();
    llamadasHoy.clear();
}

module.exports = { RONDA, MAX_LLAMADAS_DIA, observar, analizar, leerRecuerdo, resolver, reiniciar };
