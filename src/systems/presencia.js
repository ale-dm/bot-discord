// 🔌 Presencia de /conectar: el bot entra a un canal de voz y se queda el tiempo que elija quien lo pide (30 min por
// defecto). Es el dueño de esa conexión: los demás consumidores de voz (/tts, el Duende por voz, la conversación en
// directo, /sonidos) la reutilizan en su canal o se niegan, y nunca la destruyen (#499). Si empieza una conversación de
// voz con el Duende, esta se retira (la conversación manda). La salida automática espera a que acabe un sonido, un /tts
// que esté hablando o una conversación en marcha.
// 🛡️ Guardia (#553): la misma presencia, pero con `guardia: { porUserId, desde }` y sin salida automática. /conectar no
// la sustituye, ni la renueva, ni la cierra; solo otra guardia la sustituye. El registro persistido vive en
// systems/guardia.js, que pasa `alTerminar` para borrarlo cuando la presencia se acaba.
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require("@discordjs/voice");
const { createLogger } = require("../core/logger");
const ocupacion = require("./ocupacion");

const log = createLogger("Presencia");
const MINUTOS = 30;
// Lo que se puede elegir con /conectar (en minutos).
const DURACIONES = [15, 30, 60, 120];
// Tras un corte (me mueven o hay un fallo de red), cuánto se espera a que la conexión se recupere sola.
const RECONEXION_MS = 5 * 1000;

const presencias = new Map(); // guildId -> { conexion, canalId, canalNombre, expira, timer, guardia, alTerminar }

/** La presencia activa de un servidor, o null. */
function actual(guildId) {
    return presencias.get(String(guildId)) || null;
}

/** ¿Es esta conexión la que puso /conectar? Quien no sea el dueño no la destruye. */
function esDePresencia(guildId, conexion) {
    return !!conexion && presencias.get(String(guildId))?.conexion === conexion;
}

/** El aviso de que el bot está de guardia (para quien intenta usar /conectar mientras dura). */
function avisoGuardia(p) {
    return `🛡️ Estoy de guardia en **${p.canalNombre}**. Solo quien la puso o un admin puede quitarla, desde el panel de /duende.`;
}

// La presencia se acaba: se olvida y, si es una guardia, se avisa a quien la guarda (para borrar su registro).
function olvidar(guildId, p) {
    clearTimeout(p.timer);
    presencias.delete(String(guildId));
    try {
        p.alTerminar?.();
    } catch (e) {
        log.warn(`Error cerrando la presencia de ${guildId}: ${e.message}`);
    }
}

/** Se sale del canal y se olvida la presencia (también una guardia). @returns {boolean} si había una presencia */
function desconectar(guildId) {
    const p = presencias.get(String(guildId));
    if (!p) return false;
    olvidar(guildId, p);
    try {
        p.conexion.destroy();
    } catch {
        /* ya estaba cerrada */
    }
    log.info(`Me salgo de ${p.canalNombre} (${guildId})`);
    return true;
}

function programarSalida(guildId, p, ms) {
    if (p.guardia) return; // La guardia no caduca.
    p.timer = setTimeout(() => {
        // No se corta nada en curso: ni una conversación, ni un sonido a mitad, ni un /tts que está hablando.
        const espera = ocupacion.esperaPendiente(guildId);
        if (espera) return programarSalida(guildId, p, espera);
        desconectar(guildId);
    }, ms);
    p.timer.unref?.();
}

// Si Discord me echa del canal o se cierra la conexión, la presencia se olvida sola. Una guardia, además, espera un
// poco a que un corte se recupere solo (me han movido de canal, un fallo de red) y, si no, cierra la conexión.
function vigilarConexion(guildId, p, deps) {
    const { conexion } = p;
    conexion.on?.(VoiceConnectionStatus.Destroyed, () => {
        if (presencias.get(String(guildId)) !== p) return;
        olvidar(guildId, p);
        log.info(`La conexión de ${p.canalNombre} (${guildId}) se ha cerrado${p.guardia ? ": se acaba la guardia" : ""}`);
    });
    if (!p.guardia) return;
    const recuperar =
        deps.esperarReconexion ||
        ((c) =>
            Promise.race([
                entersState(c, VoiceConnectionStatus.Signalling, RECONEXION_MS),
                entersState(c, VoiceConnectionStatus.Connecting, RECONEXION_MS),
            ]));
    conexion.on?.(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await recuperar(conexion);
        } catch {
            if (presencias.get(String(guildId)) !== p) return;
            log.warn(`Me han sacado de ${p.canalNombre} (${guildId}): se acaba la guardia`);
            try {
                conexion.destroy();
            } catch {
                /* ya estaba cerrada */
            }
        }
    });
}

// Lo que impide entrar ahora mismo (o null si se puede).
function motivoNoEntra(canal, guardia) {
    const guildId = canal.guild.id;
    const previa = presencias.get(String(guildId));
    if (previa?.guardia && !guardia) return avisoGuardia(previa);
    if (ocupacion.ocupado(guildId, "conversacion")) return "Ahora mismo hay una conversación de voz con el Duende en el servidor.";
    if (ocupacion.ocupado(guildId, "sonidos")) return "Ahora mismo suena un sonido en el servidor. Prueba en un momento.";
    const permisos = canal.permissionsFor(canal.guild.members.me);
    if (!permisos || !permisos.has("Connect") || !permisos.has("Speak"))
        return "Me faltan permisos para entrar a ese canal o hablar en él.";
    return null;
}

/**
 * Entra al canal y se queda `minutos`. Sustituye a la presencia que hubiera en el servidor, salvo una guardia (solo otra
 * guardia la sustituye). Con `guardia: { porUserId }` se queda indefinidamente; `alTerminar` se llama cuando se acaba.
 * @returns {Promise<{ ok: boolean, motivo?: string, expira?: number|null, canal?: string }>}
 */
async function conectar(canal, { minutos = MINUTOS, guardia = null, alTerminar = null, deps = {} } = {}) {
    const guildId = canal.guild.id;
    const motivo = motivoNoEntra(canal, guardia);
    if (motivo) return { ok: false, motivo };
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
    const p = {
        conexion,
        canalId: canal.id,
        canalNombre: canal.name,
        expira: guardia ? null : Date.now() + minutos * 60 * 1000,
        timer: null,
        guardia: guardia ? { porUserId: String(guardia.porUserId), desde: guardia.desde ?? Date.now() } : null,
        alTerminar,
    };
    presencias.set(String(guildId), p);
    programarSalida(guildId, p, minutos * 60 * 1000);
    vigilarConexion(guildId, p, deps);
    log.info(`Entro en ${canal.name} (${guildId}) ${guardia ? `de guardia (la pone ${guardia.porUserId})` : `por ${minutos} minutos`}`);
    return { ok: true, expira: p.expira, canal: canal.name };
}

/**
 * Renueva el tiempo de la presencia activa: se queda `minutos` desde ahora (no suma al tiempo que quedaba). Una guardia
 * no se renueva: no caduca.
 * @returns {{ ok: boolean, motivo?: string, expira?: number, canal?: string }}
 */
function renovar(guildId, minutos = MINUTOS) {
    const p = presencias.get(String(guildId));
    if (!p) return { ok: false, motivo: "No estoy conectado." };
    if (p.guardia) return { ok: false, motivo: avisoGuardia(p) };
    clearTimeout(p.timer);
    p.expira = Date.now() + minutos * 60 * 1000;
    programarSalida(guildId, p, minutos * 60 * 1000);
    log.info(`Renuevo ${p.canalNombre} (${guildId}) por ${minutos} minutos`);
    return { ok: true, expira: p.expira, canal: p.canalNombre };
}

module.exports = { MINUTOS, DURACIONES, actual, conectar, desconectar, renovar, esDePresencia, avisoGuardia };
