// 🔊 Quién está usando el audio de un servidor ahora mismo: un sonido de /sonidos, un /tts que habla o una conversación en
// directo con el Duende. Cada uno se apunta al cargarse, y /conectar mira aquí para no salir ni sustituirse a mitad (#499).
// Así la presencia no tiene que cargar esos módulos, y no hay ciclos de dependencias entre ellos.
const REINTENTO_CORTO_MS = 10 * 1000;
const REINTENTO_LARGO_MS = 5 * 60 * 1000;

const ocupantes = new Map(); // nombre -> { ocupa(guildId), reintentoMs }

/** Se apunta un ocupante. Devuelve la función que lo quita. */
function registrar(nombre, ocupa, reintentoMs) {
    const entrada = { ocupa, reintentoMs };
    ocupantes.set(nombre, entrada);
    return () => {
        if (ocupantes.get(nombre) === entrada) ocupantes.delete(nombre);
    };
}

/** ¿Lo ocupa `nombre` ahora mismo en ese servidor? */
function ocupado(guildId, nombre) {
    return !!ocupantes.get(nombre)?.ocupa(guildId);
}

/** Cuánto esperar antes de volver a mirar: el mayor de los reintentos de quien lo ocupa, o 0 si el servidor está libre. */
function esperaPendiente(guildId) {
    let espera = 0;
    for (const { ocupa, reintentoMs } of ocupantes.values()) {
        if (ocupa(guildId)) espera = Math.max(espera, reintentoMs);
    }
    return espera;
}

module.exports = { REINTENTO_CORTO_MS, REINTENTO_LARGO_MS, registrar, ocupado, esperaPendiente };
