// Mensajes que llegan de Gemini Live durante una llamada: llamadas a herramientas (y «colgar»), el audio de salida y las
// transcripciones. Sacado de conexion.js, que se queda con la conexión y la sesión.

const { pararConversacion } = require("./sesion");
const { responderLlamadasHerramientas } = require("./declaraciones");
const { PALABRA_LLAMADA } = require("./constantes");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

/**
 * Las llamadas a herramientas de un mensaje: «colgar_llamada» corta la conversación y el resto
 * se responde con sus datos.
 */
function procesarLlamadas(liveSession, toolCall, { guildId, toolContext }) {
    const llamadas = toolCall.functionCalls || [];
    const colgar = llamadas.find((fc) => fc.name === "colgar_llamada");
    if (colgar) {
        liveSession.sendToolResponse({
            functionResponses: [{ id: colgar.id, name: colgar.name, response: { ok: true } }],
        });
        log.info(`Colgando la llamada en el servidor ${guildId}: pedido por voz.`);
        pararConversacion(guildId, "pedido por voz");
    }
    const resto = llamadas.filter((fc) => fc.name !== "colgar_llamada");
    if (resto.length) {
        responderLlamadasHerramientas(liveSession, { ...toolCall, functionCalls: resto }, toolContext).catch((e) =>
            log.warn(`Error respondiendo herramientas en voz en directo: ${e.message}`),
        );
    }
}

/**
 * Pasa a ffmpeg un trozo de audio de Gemini. Devuelve false si se descarta porque aún no le han dicho
 * «duende» en este turno (modo solo si le llaman).
 */
function reenviarAudioSalida(data, sesion) {
    const buf = Buffer.from(data, "base64");
    if (!sesion.permitirAudioSalida) {
        if (!sesion.avisoIgnoradoEsteTurno) {
            sesion.avisoIgnoradoEsteTurno = true;
            log.debug(`Se ignora la respuesta de Gemini: no le han dicho "duende" en este turno (modo solo si le llaman).`);
        }
        return false;
    }
    sesion.chunksAudioSalida = (sesion.chunksAudioSalida || 0) + 1;
    if (sesion.chunksAudioSalida === 1) {
        log.info(`Primer trozo de audio de Gemini recibido (${buf.length} bytes) — pasándolo a ffmpeg.`);
    }
    try {
        // La clase FFmpeg de prism-media pone write/end directamente en la
        // instancia (copiados del stdin interno): no existe .stdin.
        sesion.ffmpeg.write(buf);
    } catch (e) {
        log.warn(`Error pasando el audio de Gemini a ffmpeg: ${e.message}`);
    }
    return true;
}

/**
 * Transcripciones de un mensaje: lo que dice el Duende (solo log) y lo que dice el usuario, que, si contiene la
 * palabra de llamada, deja pasar la respuesta de voz de este turno.
 */
function procesarTranscripciones(message, sesion) {
    if (message.serverContent?.outputTranscription?.text) {
        log.debug(`Duende (voz en directo): ${message.serverContent.outputTranscription.text}`);
    }
    if (message.serverContent?.inputTranscription?.text) {
        const texto = message.serverContent.inputTranscription.text;
        log.debug(`Usuario (voz en directo): ${texto}`);
        sesion.turnoTranscripcion += texto;
        // En cuanto se oye la palabra de llamada en este turno, se deja pasar la
        // respuesta — no hace falta esperar a que acabe de hablar para decidirlo.
        if (sesion.soloSiLeLlaman && PALABRA_LLAMADA.test(sesion.turnoTranscripcion)) {
            sesion.permitirAudioSalida = true;
        }
    }
}

module.exports = { procesarLlamadas, reenviarAudioSalida, procesarTranscripciones };
