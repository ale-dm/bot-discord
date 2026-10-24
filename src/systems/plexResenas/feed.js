// 📣 Feed de reseñas (#573): decide si una reseña recién guardada sale en el canal `plex.resenas_canal` y qué texto
// lleva. Sin Discord: el mensaje está en discord/mensajes/resenaFeed y el envío en discord/envios/resenaFeed.
const guildSettings = require("../guildSettings");
const privacidad = require("./privacidad");

const MAX_EXTRACTO = 300;

/** El canal del feed del servidor, o null si no hay (vacío = no se publica nada). */
function canal(guildId) {
    const id = String(guildSettings.getSettings(guildId).plex.resenas_canal || "").trim();
    return id || null;
}

/** El extracto de una reseña: null si tiene spoilers o no tiene texto; si no, como mucho 300 caracteres. */
function extracto(resena) {
    if (!resena || resena.spoilers) return null;
    const texto = String(resena.texto || "").trim();
    if (!texto) return null;
    return texto.length > MAX_EXTRACTO ? `${texto.slice(0, MAX_EXTRACTO - 1).trimEnd()}…` : texto;
}

/**
 * Lo que hay que publicar tras `guardar()`, o null: sin canal, si falló, si es la edición de una que ya existía (cada
 * reseña sale una sola vez) o si está oculta (la reseña o todas las de esa persona).
 * @returns {{ canalId: string, resena: object } | null}
 */
function aPublicar(guildId, resultado) {
    if (!resultado?.ok || !resultado.nueva || !resultado.resena) return null;
    const canalId = canal(guildId);
    if (!canalId) return null;
    const { resena } = resultado;
    if (resena.oculto || privacidad.oculto(guildId, resena.userId)) return null;
    return { canalId, resena };
}

module.exports = { MAX_EXTRACTO, canal, extracto, aPublicar };
