// 📣 Adaptador del feed de reseñas (#573): publica en `plex.resenas_canal` la reseña que se acaba de guardar. Qué se
// publica lo decide systems/plexResenas/feed; aquí solo se busca el canal y se envía (best-effort).
const feed = require("../../systems/plexResenas/feed");
const { mensajeFeedResena } = require("../mensajes/resenaFeed");
const { createLogger } = require("../../core/logger");

const log = createLogger("Plex").child("Reseñas");

/**
 * Se llama justo después de `plexResenas.guardar()`. Sin canal, si es una edición o si está oculta, no hace nada.
 * Un canal borrado, de otro servidor o sin permisos se registra y se sigue: la reseña ya está guardada.
 * @returns {Promise<boolean>} si se ha publicado
 */
async function publicarResena(client, guildId, resultado) {
    const aPublicar = feed.aPublicar(guildId, resultado);
    if (!aPublicar) return false;
    const { canalId, resena } = aPublicar;
    try {
        const canal = client?.channels?.cache?.get(canalId) || (await client?.channels?.fetch(canalId).catch(() => null));
        if (!canal?.isTextBased?.() || String(canal.guildId) !== String(guildId)) {
            log.warn(`Feed de reseñas: el canal ${canalId} de ${guildId} no existe, no es de texto o es de otro servidor`);
            return false;
        }
        await canal.send(mensajeFeedResena(resena));
        return true;
    } catch (e) {
        log.warn(`Feed de reseñas: no se pudo publicar «${resena.titulo}» en ${canalId}: ${e.message}`);
        return false;
    }
}

module.exports = { publicarResena };
