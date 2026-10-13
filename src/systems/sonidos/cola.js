// 📋 Cola de sonidos por servidor (#327): lo que se pulsa mientras suena otro espera su turno (hasta MAX_COLA) en vez de rechazarse.
const MAX_COLA = 5;

const colas = new Map(); // guildId -> [{ canal, sonido, deps, resolve }]

/** Pone una entrada al final de la cola. @returns {number|null} su puesto (1 = la siguiente en sonar), o null si la cola está llena */
function encolar(guildId, entrada) {
    const cola = colas.get(guildId) || [];
    if (cola.length >= MAX_COLA) return null;
    cola.push(entrada);
    colas.set(guildId, cola);
    return cola.length;
}

/** Saca la siguiente entrada (o undefined si no hay). */
function siguiente(guildId) {
    const cola = colas.get(guildId);
    const entrada = cola?.shift();
    if (cola && !cola.length) colas.delete(guildId);
    return entrada;
}

const longitud = (guildId) => colas.get(guildId)?.length || 0;

module.exports = { MAX_COLA, encolar, siguiente, longitud };
