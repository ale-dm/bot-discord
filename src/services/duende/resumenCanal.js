// 📝 Resumen de un canal con el Duende (#382): se leen los últimos N mensajes de personas (1 a 200), se le pide a Gemini un resumen de unas
// cinco líneas con el tono de la personalidad del canal y se limpia: sin menciones con @ ni enlaces. El historial por canal del Duende
// solo guarda 20 mensajes, así que aquí se lee el canal de verdad.
const { generarConGemini, isGeminiProhibitedContentError } = require("./gemini");
const perfiles = require("../../systems/duende/perfiles");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Resumen");

const MAX_MENSAJES = 200;
const POR_PAGINA = 100;
const MAX_CARACTERES_MENSAJE = 300;

/** Un texto sin enlaces ni menciones: lo que sale del bot nunca pinga a nadie ni lleva URLs. */
function limpiar(texto) {
    return String(texto || "")
        .replace(/https?:\/\/\S+/gi, "[enlace]")
        .replace(/<@[!&]?\d+>/g, "alguien")
        .replace(/<#\d+>/g, "un canal")
        .replace(/@(everyone|here)/gi, "todos")
        .replace(/@/g, "")
        .trim();
}

/** Los últimos `cantidad` mensajes de personas del canal, del más antiguo al más nuevo: [{ autor, texto }]. */
async function leerMensajes(channel, cantidad) {
    const quiero = Math.max(1, Math.min(MAX_MENSAJES, Math.floor(cantidad) || 1));
    const recogidos = [];
    let antes;
    // Se piden páginas hasta tener los mensajes de personas que se piden (los de bots y los vacíos no cuentan).
    for (let ronda = 0; ronda < 6 && recogidos.length < quiero; ronda++) {
        const pagina = await channel.messages.fetch({ limit: POR_PAGINA, ...(antes ? { before: antes } : {}) });
        if (!pagina.size) break;
        for (const m of pagina.values()) {
            if (m.author?.bot || !String(m.content || "").trim()) continue;
            recogidos.push({ autor: m.member?.displayName || m.author?.username || "alguien", texto: m.content, ts: m.createdTimestamp });
        }
        antes = pagina.last()?.id;
        if (pagina.size < POR_PAGINA) break;
    }
    return recogidos
        .sort((a, b) => b.ts - a.ts)
        .slice(0, quiero)
        .reverse()
        .map(({ autor, texto }) => ({ autor: limpiar(autor), texto: limpiar(texto).slice(0, MAX_CARACTERES_MENSAJE) }));
}

function instrucciones(channelId) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    return (
        `${base} Resume en español, en unas cinco líneas como máximo, de qué se ha hablado en este chat y qué se ha decidido o ` +
        "quedado pendiente. Mantén tu estilo y tu tono. No uses menciones con @ ni enlaces, no inventes nada que no esté en los mensajes " +
        "y no repitas los mensajes tal cual."
    );
}

/**
 * El resumen de unos mensajes, con la personalidad del canal. Si Gemini bloquea el contenido, reintenta con un prompt neutro.
 * Nunca devuelve menciones ni enlaces.
 * @param {{ autor: string, texto: string }[]} mensajes
 */
async function resumir(channelId, mensajes, deps = { generar: generarConGemini }) {
    const conversacion = mensajes.map((m) => `${m.autor}: ${m.texto}`).join("\n");
    const partes = [{ text: instrucciones(channelId) }, { text: `Mensajes (de más antiguo a más nuevo):\n${conversacion}` }];
    try {
        return limpiar(await deps.generar(partes, { maxTokens: 600, thinkingBudget: 0 })).slice(0, 1800);
    } catch (e) {
        if (!isGeminiProhibitedContentError(e.message)) throw e;
        log.warn("Gemini bloqueó el resumen: se reintenta con un prompt neutro");
        const neutro = [
            {
                text: "Resume en español, en unas cinco líneas, de qué se ha hablado en este chat de amigos. Sé neutral y respetuoso, sin menciones ni enlaces.",
            },
            { text: `Mensajes:\n${conversacion}` },
        ];
        return limpiar(await deps.generar(neutro, { maxTokens: 400, thinkingBudget: 0 })).slice(0, 1800);
    }
}

module.exports = { MAX_MENSAJES, limpiar, leerMensajes, resumir };
