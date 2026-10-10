// Conversación por voz en directo con el Duende (Gemini Live API): audio bidireccional real,
// no por turnos como /escuchar (Vosk + TTS por lotes, que sigue igual y sin tocar — esto es
// una funcionalidad nueva y aparte, /conversación).
//
// El coste por minuto es bajo (~$0,005/min entrada + $0,018/min salida), pero se cobra
// mientras la conexión esté abierta, no solo cuando alguien habla — por eso hay un corte por
// inactividad y un tope de duración, los dos obligatorios, no opcionales.

const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

const { sesiones, hayConversacionActiva, pararConversacion, comprobarInicio, crearSesion, limpiarSesion } = require("./liveVoz/sesion");
const {
    construirDeclaracionesHerramientas,
    construirInstruccionesSistema,
    responderLlamadasHerramientas,
} = require("./liveVoz/declaraciones");
const { conectarVoz, conectarSalida, conectarGemini, saludar } = require("./liveVoz/conexion");
const { escucharHablantes, programarLimites } = require("./liveVoz/captura");
const { LIVE_MODEL, LIVE_VOICE } = require("./liveVoz/constantes");

async function empezarConversacion(interaction, { onTerminada, soloSiLeLlaman = true, soloEscuchaA = null, tertulia = false } = {}) {
    const comprobacion = comprobarInicio(interaction, { tertulia, soloEscuchaA });
    if (comprobacion.error) return { ok: false, error: comprobacion.error };
    const { voiceChannel } = comprobacion;

    const guildId = interaction.guildId;
    // El canal de TEXTO desde donde se pide, igual que con las herramientas del chat normal.
    const channelId = interaction.channelId;
    const toolContext = { guildId, userId: interaction.user.id, guild: interaction.guild, channelId };
    const declaraciones = construirDeclaracionesHerramientas(guildId, channelId);
    const systemInstruction = construirInstruccionesSistema(channelId, { tertulia });

    const sesion = crearSesion({ onTerminada, soloSiLeLlaman, soloEscuchaA, tertulia });
    sesiones.set(guildId, sesion);

    try {
        sesion.connection = await conectarVoz(interaction, voiceChannel);
        conectarSalida(sesion.connection, sesion);
        sesion.liveSession = await conectarGemini(interaction, voiceChannel, sesion, { systemInstruction, declaraciones, toolContext });
        log.info(`Sesión de Gemini Live conectada (modelo ${LIVE_MODEL}, voz ${LIVE_VOICE}).`);
        saludar(sesion.liveSession);
        escucharHablantes(interaction, sesion);
        programarLimites(sesion, guildId);
        return { ok: true, voiceChannel };
    } catch (err) {
        sesiones.delete(guildId);
        limpiarSesion(sesion);
        log.warn(`No se pudo empezar la conversación en directo: ${err.stack || err.message}`);
        return { ok: false, error: "No se pudo conectar. Inténtalo otra vez en un momento." };
    }
}

module.exports = {
    hayConversacionActiva,
    empezarConversacion,
    pararConversacion,
    construirDeclaracionesHerramientas,
    construirInstruccionesSistema,
    responderLlamadasHerramientas,
};
