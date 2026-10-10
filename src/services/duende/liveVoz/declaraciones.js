// Herramientas que el Duende puede usar mientras habla en directo: sus declaraciones, las instrucciones del sistema y las respuestas a las llamadas.

const { Type: SchemaType } = require("@google/genai");
const perfiles = require("../../../systems/duende/perfiles");
const tautulliClient = require("../../tautulliClient");
const seerrClient = require("../../seerrClient");
const {
    DUENDE_CORE_TOOL_DECLARATIONS,
    DUENDE_PLEX_TOOL_DECLARATIONS,
    DUENDE_SEERR_TOOL_DECLARATIONS,
    DUENDE_TOOL_EXECUTORS,
} = require("../herramientas");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

// Solo tiene sentido en una llamada de voz, no en el chat de texto: no va en herramientas.js.
const DUENDE_LIVE_TOOL_DECLARATIONS = [
    {
        name: "colgar_llamada",
        description:
            "Cuelga y sale de esta llamada de voz en directo. Llámala solo cuando te lo pidan explícitamente (p. ej. 'vete', 'cuelga', 'desconéctate', 'adiós, puedes irte').",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
];

// Mismas herramientas que el chat de texto (services/duende/gemini.js), con la misma regla de
// qué Plex/Seerr se permite según el canal de TEXTO desde donde se pide /conversación (el de voz
// no tiene lista de permitidos propia), más las propias de la llamada (colgar).
function construirDeclaracionesHerramientas(guildId, channelId) {
    const hasChannelCtx = guildId && channelId;
    const plexAllowed = hasChannelCtx && tautulliClient.isChannelAllowed(guildId, channelId);
    const seerrAllowed = hasChannelCtx && seerrClient.isChannelAllowed(guildId, channelId);
    return [
        ...DUENDE_CORE_TOOL_DECLARATIONS,
        ...DUENDE_LIVE_TOOL_DECLARATIONS,
        ...(plexAllowed ? DUENDE_PLEX_TOOL_DECLARATIONS : []),
        ...(seerrAllowed ? DUENDE_SEERR_TOOL_DECLARATIONS : []),
    ];
}

// A diferencia del chat de texto (duende.js), la sesión de Gemini Live solo acepta un
// systemInstruction fijo al conectar, no uno distinto por mensaje: se construye una vez aquí.
// En la llamada puede hablar más de una persona (no solo quien pidió /conversación) — antes de
// cada turno se avisa de quién habla ahora mismo (ver empezarConversacion), así que aquí solo se
// deja la instrucción general de qué hacer con eso.
function construirInstruccionesSistema(channelId, { tertulia = false } = {}) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    const quien = tertulia
        ? "En la llamada hablan varias personas a la vez y no sé quién dice cada cosa: contesta al grupo, sin dirigirte a nadie en concreto salvo que te nombren. "
        : "En la llamada puede hablar más de una persona: antes de cada turno te diré quién es quien va a hablar y lo que sepas de ella, para que sepas a quién te diriges sin tener que preguntarlo; ";
    return (
        `${base} Esto es una conversación de voz en directo, no texto escrito: responde corto y de forma natural, ` +
        "como hablarías en persona, sin markdown ni listas. Si tienes herramientas disponibles que te den datos " +
        "reales (nivel, saldo, Plex...), úsalas siempre antes de contestar, sea cual sea tu personalidad; no te " +
        `niegues a mirar ni digas que no puedes saberlo si hay una herramienta que sí puede. ${quien}` +
        "usa consultar_perfil_persona para cualquier otra persona de la que se hable."
    );
}

/** Ejecuta las llamadas a herramientas que pide Gemini Live y le manda el resultado. Exportada para poder probarla sin un socket real. */
async function responderLlamadasHerramientas(liveSession, toolCall, toolContext) {
    const functionResponses = await Promise.all(
        (toolCall.functionCalls || []).map(async (fc) => {
            let result;
            try {
                const executor = DUENDE_TOOL_EXECUTORS[fc.name];
                result = executor ? await executor(fc.args, toolContext) : { error: "Herramienta desconocida." };
            } catch (err) {
                log.warn(`Error ejecutando herramienta ${fc.name}: ` + (err && err.message));
                result = { error: "No se pudo obtener el dato." };
            }
            log.info(`Herramienta usada en voz en directo: ${fc.name}(${JSON.stringify(fc.args || {})}) -> ${JSON.stringify(result)}`);
            return { id: fc.id, name: fc.name, response: result };
        }),
    );
    liveSession.sendToolResponse({ functionResponses });
}

module.exports = {
    DUENDE_LIVE_TOOL_DECLARATIONS,
    construirDeclaracionesHerramientas,
    construirInstruccionesSistema,
    responderLlamadasHerramientas,
};
