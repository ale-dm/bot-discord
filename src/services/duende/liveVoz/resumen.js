// 📝 Resumen al terminar /conversación (#395): mientras dura la llamada se van acumulando en memoria las transcripciones (lo que
// dice quien habla y lo que dice el Duende); al terminarla se le pide a Gemini un resumen y se publica en el canal de texto desde
// el que se pidió. Sin transcripciones no se publica nada. El texto solo vive en la sesión: no se escribe en disco ni se guarda tras
// el resumen. Siempre se hace (no hay opción) y, como en la tertulia no se sabe quién habla, no se atribuyen frases a nadie.
const { generarConGemini } = require("../gemini");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

const MAX_CARACTERES = 20_000;
const MIN_CARACTERES = 40;
const TIMEOUT_MS = 30_000;

/** Añade un trozo de transcripción a la sesión. Los trozos seguidos del mismo que habla se juntan; pasados MAX_CARACTERES, lo viejo se tira. */
function acumular(sesion, quien, texto) {
    const limpio = String(texto || "").trim();
    if (!limpio) return;
    const t = (sesion.transcripcion ||= { entradas: [], caracteres: 0 });
    const ultima = t.entradas.at(-1);
    if (ultima && ultima.quien === quien) ultima.texto += ` ${limpio}`;
    else t.entradas.push({ quien, texto: limpio });
    t.caracteres += limpio.length + 1;
    while (t.caracteres > MAX_CARACTERES && t.entradas.length > 1) {
        const vieja = t.entradas.shift();
        t.caracteres -= vieja.texto.length + 1;
    }
}

const aTexto = (t) => (t?.entradas || []).map((e) => `${e.quien === "duende" ? "Duende" : "Alguien"}: ${e.texto}`).join("\n");

/** El resumen de una conversación (unas cuatro líneas), o null si no hubo nada que resumir. */
async function resumir(transcripcion, deps = { generar: generarConGemini }) {
    const texto = aTexto(transcripcion);
    if (texto.length < MIN_CARACTERES) return null;
    const parts = [
        {
            text:
                "Resume en español, en unas cuatro líneas, lo que se ha hablado en esta conversación de voz entre un grupo de amigos y el " +
                "Duende (un bot). Di los temas y lo que se decidió o quedó pendiente. No atribuyas frases a personas concretas (no se sabe " +
                "quién habló), sin menciones con @ ni enlaces.",
        },
        { text: `Transcripción:\n${texto}` },
    ];
    const resumen = await Promise.race([
        deps.generar(parts, { maxTokens: 500, thinkingBudget: 0 }),
        new Promise((_, rechazo) => setTimeout(() => rechazo(new Error("El resumen tardó demasiado")), TIMEOUT_MS).unref()),
    ]);
    return String(resumen || "")
        .replace(/https?:\/\/\S+/gi, "[enlace]")
        .replace(/@/g, "")
        .trim()
        .slice(0, 1800);
}

/** Publica el resumen en el canal de texto de la sesión. Nunca lanza: un fallo se anota en el log. @returns {Promise<boolean>} si se publicó */
async function publicar(client, channelId, transcripcion, deps = { generar: generarConGemini }) {
    try {
        const resumen = await resumir(transcripcion, deps);
        if (!resumen) return false;
        const canal = await client.channels.fetch(channelId);
        await canal.send({ content: `📝 **Resumen de la conversación**\n${resumen}`, allowedMentions: { parse: [] } });
        return true;
    } catch (e) {
        log.warn(`No se pudo publicar el resumen de la conversación en directo: ${e.message}`);
        return false;
    }
}

module.exports = { MAX_CARACTERES, MIN_CARACTERES, acumular, resumir, publicar };
