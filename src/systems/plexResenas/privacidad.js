// 🍿 Privacidad de las reseñas: quien la oculta no sale en medias, rankings ni listas públicas (las suyas sí las ve).
const db = require("../../core/db");

/** ¿Ha ocultado esta persona todas sus reseñas? */
function oculto(guildId, userId) {
    const fila = db.prepare("SELECT ocultar_resenas FROM plex_preferencias WHERE guildId = ? AND userId = ?").get(guildId, String(userId));
    return Boolean(fila?.ocultar_resenas);
}

/** Oculta o vuelve a enseñar todas sus reseñas (no toca las de los demás). */
function setOculto(guildId, userId, valor) {
    db.prepare(
        `INSERT INTO plex_preferencias (guildId, userId, ocultar_resenas) VALUES (?, ?, ?)
         ON CONFLICT(guildId, userId) DO UPDATE SET ocultar_resenas = excluded.ocultar_resenas`,
    ).run(guildId, String(userId), valor ? 1 : 0);
}

module.exports = { oculto, setOculto };
