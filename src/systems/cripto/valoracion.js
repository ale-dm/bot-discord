// Caché corta de la valoración de la cartera cripto para el panel de economía (#487): se repinta en cada clic y la
// valoración consulta precios, así que se guarda 30 segundos por servidor y persona. Comprar o vender la invalida, para que
// el panel muestre enseguida lo nuevo. Un precio que cambia por lo que hacen otros puede tardar hasta 30 s en verse.
const { CacheLimitada } = require("../../core/cacheLimitada");

const TTL_MS = 30_000;
const cache = new CacheLimitada({ max: 2000, ttlMs: TTL_MS });
const clave = (guildId, userId) => `${guildId ?? ""}|${userId}`;

/** La valoración guardada de alguien, o la que calcula `calcular()` (que se guarda; si falla, no se guarda nada). */
async function obtener(guildId, userId, calcular) {
    const k = clave(guildId, userId);
    const guardada = cache.get(k);
    if (guardada) return guardada;
    const valoracion = await calcular();
    cache.set(k, valoracion);
    return valoracion;
}

/** Olvida la valoración de alguien (tras comprar o vender). */
function invalidar(guildId, userId) {
    cache.delete(clave(guildId, userId));
}

module.exports = { TTL_MS, obtener, invalidar };
