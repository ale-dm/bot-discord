// 🔌 Presencia de /conectar: el bot entra a un canal de voz y se queda el tiempo que elija quien lo pide (30 min por
// defecto). Es el dueño de esa conexión: los demás consumidores de voz (/tts, el Duende por voz, la conversación en
// directo, /sonidos) la reutilizan en su canal o se niegan, y nunca la destruyen (#499). Si empieza una conversación de
// voz con el Duende, esta se retira (la conversación manda). La salida automática espera a que acabe un sonido, un /tts
// que esté hablando o una conversación en marcha.
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require("@discordjs/voice");
const { createLogger } = require("../core/logger");
const ocupacion = require("./ocupacion");

const log = createLogger("Presencia");
const MINUTOS = 30;
// Lo que se puede elegir con /conectar (en minutos).
const DURACIONES = [15, 30, 60, 120];

const presencias = new Map(); // guildId -> { conexion, canalId, canalNombre, expira, timer }

/** La presencia activa de un servidor, o null. */
function actual(guildId) {
    return presencias.get(String(guildId)) || null;
}

/** ¿Es esta conexión la que puso /conectar? Quien no sea el dueño no la destruye. */
function esDePresencia(guildId, conexion) {
    return !!conexion && presencias.get(String(guildId))?.conexion === conexion;
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
        // No se corta nada en curso: ni una conversación, ni un sonido a mitad, ni un /tts que está hablando.
        const espera = ocupacion.esperaPendiente(guildId);
        if (espera) return programarSalida(guildId, p, espera);
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
    if (ocupacion.ocupado(guildId, "conversacion"))
        return { ok: false, motivo: "Ahora mismo hay una conversación de voz con el Duende en el servidor." };
    if (ocupacion.ocupado(guildId, "sonidos"))
        return { ok: false, motivo: "Ahora mismo suena un sonido en el servidor. Prueba en un momento." };
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

/**
 * Renueva el tiempo de la presencia activa: se queda `minutos` desde ahora (no suma al tiempo que quedaba).
 * @returns {{ ok: boolean, motivo?: string, expira?: number, canal?: string }}
 */
function renovar(guildId, minutos = MINUTOS) {
    const p = presencias.get(String(guildId));
    if (!p) return { ok: false, motivo: "No estoy conectado." };
    clearTimeout(p.timer);
    p.expira = Date.now() + minutos * 60 * 1000;
    programarSalida(guildId, p, minutos * 60 * 1000);
    log.info(`Renuevo ${p.canalNombre} (${guildId}) por ${minutos} minutos`);
    return { ok: true, expira: p.expira, canal: p.canalNombre };
}

module.exports = { MINUTOS, DURACIONES, actual, conectar, desconectar, renovar, esDePresencia };
