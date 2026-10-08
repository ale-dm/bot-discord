// 🔌 Presencia de /conectar: el bot entra a un canal de voz y se queda MINUTOS minutos (30 por defecto), para que los
// sonidos de /sonidos suenen sin entrar y salir cada vez. Una sola presencia por servidor. Si empieza una conversación de
// voz con el Duende, esta se retira (la conversación manda) y no se corta una conversación en marcha al caducar.
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require("@discordjs/voice");
const { createLogger } = require("../core/logger");

const log = createLogger("Presencia");
const MINUTOS = 30;
const RETRASO_SI_HAY_CONVERSACION_MS = 5 * 60 * 1000;
const RETRASO_SI_SUENA_MS = 10 * 1000;

const presencias = new Map(); // guildId -> { conexion, canalId, canalNombre, expira, timer }

/** La presencia activa de un servidor, o null. */
function actual(guildId) {
    return presencias.get(String(guildId)) || null;
}

/** ¿Hay una conversación de voz con el Duende en el servidor? (se pide aquí para no cargar el módulo de voz al arrancar). */
function conversacionDelDuende(guildId) {
    return require("../services/duende/liveVoz").hayConversacionActiva(guildId);
}

/** ¿Suena ahora un sonido de /sonidos? (se pide aquí porque sonidos.js ya carga este módulo). */
function sonandoEnElServidor(guildId) {
    return require("./sonidos").sonando(guildId);
}

/** Se sale del canal y se olvida la presencia. @returns {boolean} si había una presencia */
function desconectar(guildId) {
    const p = presencias.get(String(guildId));
    if (!p) return false;
    clearTimeout(p.timer);
    presencias.delete(String(guildId));
    try {
        p.conexion.destroy();
    } catch {
        /* ya estaba cerrada */
    }
    log.info(`Me salgo de ${p.canalNombre} (${guildId})`);
    return true;
}

function programarSalida(guildId, p, ms) {
    p.timer = setTimeout(() => {
        // No se corta ni una conversación en marcha ni un sonido a mitad: se vuelve a mirar más tarde.
        if (conversacionDelDuende(guildId)) return programarSalida(guildId, p, RETRASO_SI_HAY_CONVERSACION_MS);
        if (sonandoEnElServidor(guildId)) return programarSalida(guildId, p, RETRASO_SI_SUENA_MS);
        desconectar(guildId);
    }, ms);
    p.timer.unref?.();
}

/**
 * Entra al canal y se queda `minutos`. Sustituye a la presencia que hubiera en el servidor.
 * @returns {Promise<{ ok: boolean, motivo?: string, expira?: number, canal?: string }>}
 */
async function conectar(canal, { minutos = MINUTOS, deps = {} } = {}) {
    const guildId = canal.guild.id;
    if (conversacionDelDuende(guildId))
        return { ok: false, motivo: "Ahora mismo hay una conversación de voz con el Duende en el servidor." };
    if (sonandoEnElServidor(guildId)) return { ok: false, motivo: "Ahora mismo suena un sonido en el servidor. Prueba en un momento." };
    const permisos = canal.permissionsFor(canal.guild.members.me);
    if (!permisos || !permisos.has("Connect") || !permisos.has("Speak")) {
        return { ok: false, motivo: "Me faltan permisos para entrar a ese canal o hablar en él." };
    }
    desconectar(guildId);
    const conexion = (deps.unirse || joinVoiceChannel)({
        channelId: canal.id,
        guildId,
        adapterCreator: canal.guild.voiceAdapterCreator,
        selfDeaf: true,
    });
    try {
        await (deps.esperarListo || ((c) => entersState(c, VoiceConnectionStatus.Ready, 10 * 1000)))(conexion);
    } catch (e) {
        try {
            conexion.destroy();
        } catch {
            /* ya estaba cerrada */
        }
        log.warn(`No pude entrar a ${canal.name} (${guildId}): ${e.message}`);
        return { ok: false, motivo: "No pude entrar al canal. Vuelve a intentarlo." };
    }
    const p = { conexion, canalId: canal.id, canalNombre: canal.name, expira: Date.now() + minutos * 60 * 1000, timer: null };
    presencias.set(String(guildId), p);
    programarSalida(guildId, p, minutos * 60 * 1000);
    // Si Discord me echa del canal o se cierra la conexión, la presencia se olvida sola.
    conexion.on?.(VoiceConnectionStatus.Destroyed, () => {
        if (presencias.get(String(guildId)) === p) {
            clearTimeout(p.timer);
            presencias.delete(String(guildId));
        }
    });
    log.info(`Entro en ${canal.name} (${guildId}) por ${minutos} minutos`);
    return { ok: true, expira: p.expira, canal: canal.name };
}

module.exports = { MINUTOS, actual, conectar, desconectar };
