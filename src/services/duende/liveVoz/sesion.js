// Sesiones de voz en directo por servidor: arrancar, parar, limpiar y marcar actividad.

const { Mezclador } = require("../mezclador");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende").child("VozEnVivo");

// guildId -> sesión en curso. Una conversación en directo a la vez por servidor.
const sesiones = new Map();

function hayConversacionActiva(guildId) {
    return sesiones.has(guildId);
}

function limpiarSesion(sesion) {
    clearInterval(sesion.idleCheckInterval);
    clearTimeout(sesion.maxDurationTimer);
    clearInterval(sesion.mezcladorTimer);
    clearTimeout(sesion.finTurnoTimer);
    try {
        if (sesion.receiver && sesion.onSpeakingStart) sesion.receiver.speaking.removeListener("start", sesion.onSpeakingStart);
        if (sesion.receiver && sesion.onSpeakingEnd) sesion.receiver.speaking.removeListener("end", sesion.onSpeakingEnd);
    } catch (e) {
        log.debug(`Error quitando el listener de voz: ${e.message}`);
    }
    for (const opusStream of sesion.suscripciones?.values() || []) {
        try {
            opusStream.destroy();
        } catch (e) {
            log.debug(`Error cerrando la entrada de audio: ${e.message}`);
        }
    }
    try {
        sesion.ffmpeg?.destroy();
    } catch (e) {
        log.debug(`Error cerrando ffmpeg: ${e.message}`);
    }
    try {
        sesion.liveSession?.close();
    } catch (e) {
        log.debug(`Error cerrando la sesión de Gemini Live: ${e.message}`);
    }
    try {
        sesion.connection?.destroy();
    } catch (e) {
        log.debug(`Error cerrando la conexión de voz: ${e.message}`);
    }
}

/** @returns {boolean} true si había una conversación y se ha terminado */
function pararConversacion(guildId, motivo) {
    const sesion = sesiones.get(guildId);
    if (!sesion) return false;
    sesiones.delete(guildId);
    limpiarSesion(sesion);
    log.info(`Conversación en directo terminada en el servidor ${guildId}${motivo ? ` (${motivo})` : ""}`);
    sesion.onTerminada?.(motivo);
    return true;
}

/**
 * Comprueba que se puede empezar una conversación en el canal de quien invoca.
 * @returns {{voiceChannel: object} | {error: string}}
 */
function comprobarInicio(interaction, { tertulia, soloEscuchaA }) {
    if (tertulia && soloEscuchaA) {
        return { error: "La tertulia escucha a todo el canal: no se puede combinar con «con»." };
    }
    if (sesiones.has(interaction.guildId)) {
        return { error: "Ya hay una conversación en directo en este servidor. Usa `/conversación` otra vez para terminarla." };
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return { error: "¡Debes estar en un canal de voz!" };

    const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
        return { error: "Me faltan permisos para conectar o hablar en ese canal." };
    }
    return { voiceChannel };
}

// sesion.permitirAudioSalida empieza en true para que el saludo inicial siempre se oiga;
// con soloSiLeLlaman, onSpeakingStart lo pone en false hasta que la transcripción de ese
// turno contenga PALABRA_LLAMADA (ver más abajo). hablanteActivo: userId de quien tiene el
// turno abierto ahora mismo (null = nadie); mientras esté puesto, se ignora a cualquier otra
// persona que empiece a hablar — por turnos, sin mezclar a dos personas en el mismo turno.
// soloEscuchaA: con mucha gente en el canal, escuchar a cualquiera se vuelve un caos (todos
// interrumpiéndose); con esto puesto, solo esa persona puede abrir turno, el resto se ignora
// igual que antes de soportar varias personas.
function crearSesion({ onTerminada, soloSiLeLlaman, soloEscuchaA, tertulia }) {
    return {
        ultimaActividad: Date.now(),
        onTerminada,
        soloSiLeLlaman,
        soloEscuchaA,
        permitirAudioSalida: true,
        turnoTranscripcion: "",
        hablanteActivo: null,
        // Tertulia (#16): todos a la vez, mezclados en un solo flujo (ver services/duende/mezclador.js).
        tertulia,
        hablantes: new Set(),
        enTurno: false,
        mezclador: tertulia ? new Mezclador() : null,
        suscripciones: new Map(),
    };
}

function marcarActividad(sesion) {
    sesion.ultimaActividad = Date.now();
}

/** Conecta al canal de voz (o reutiliza la conexión si ya está ahí) y espera a que esté lista. */

module.exports = { sesiones, hayConversacionActiva, limpiarSesion, pararConversacion, comprobarInicio, crearSesion, marcarActividad };
