// ⏱️ Cooldown entre sonidos de una misma persona (#324): para que nadie encadene sonidos y ocupe el canal. Por servidor y persona;
// vive en memoria (10 s no merecen la base de datos).
const COOLDOWN_MS = 10 * 1000;

const ultimos = new Map(); // `${guildId}:${userId}` -> ms del último sonido

/** Segundos que le faltan a la persona para poder pedir otro sonido (0 si ya puede). */
function segundosRestantes(guildId, userId, ahora = Date.now()) {
    const ultimo = ultimos.get(`${guildId}:${userId}`);
    return ultimo === undefined ? 0 : Math.max(0, Math.ceil((ultimo + COOLDOWN_MS - ahora) / 1000));
}

/** Anota que la persona ha pedido un sonido ahora (y tira lo caducado, para que el mapa no crezca sin fin). */
function marcar(guildId, userId, ahora = Date.now()) {
    ultimos.set(`${guildId}:${userId}`, ahora);
    if (ultimos.size > 500) for (const [clave, t] of ultimos) if (ahora - t >= COOLDOWN_MS) ultimos.delete(clave);
}

const avisoCooldown = (segundos) => `⏱️ Espera ${segundos} s antes de pedir otro sonido.`;

module.exports = { COOLDOWN_MS, segundosRestantes, marcar, avisoCooldown };
