// 🍿 Guardar, cambiar y borrar una reseña. Solo se puede valorar lo que la persona ha visto según el historial.
const db = require("../../core/db");
const plexLinks = require("../plexLinks");
const { claveDe, notaValida, textoDe, TIPOS } = require("./base");

const ahora = () => Math.floor(Date.now() / 1000);

/** La fila tal y como la usa el resto: booleanos de verdad. */
const normalizarFila = (r) => ({
    ...r,
    spoilers: Boolean(r.spoilers),
    meGusta: Boolean(r.me_gusta),
    oculto: Boolean(r.oculto),
});

/**
 * ¿Ha visto ese título? Las películas se comparan por título y año (como los trofeos); las series llegan con la fase 3
 * (#572), así que de momento solo se pueden valorar películas.
 */
function haVisto(guildId, userId, { tipo, titulo, anio }) {
    if (tipo !== "movie") return false;
    const link = plexLinks.getLinkByDiscordId(guildId, String(userId));
    if (!link) return false;
    const filas = db
        .prepare("SELECT titulo, anio FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'movie' AND visto = 1")
        .all(guildId, String(link.tautulliUserId));
    const clave = claveDe({ tipo, titulo, anio });
    return filas.some((f) => claveDe({ tipo: "movie", titulo: f.titulo, anio: f.anio }) === clave);
}

/** La reseña de una persona en un título, o null. */
function de(guildId, userId, clave) {
    const fila = db
        .prepare("SELECT * FROM plex_resenas WHERE guildId = ? AND userId = ? AND clave = ?")
        .get(guildId, String(userId), clave);
    return fila ? normalizarFila(fila) : null;
}

/**
 * Guarda o cambia la reseña de una persona. @returns {{ ok: true, resena: object } | { ok: false, motivo: string }}
 */
function guardar(guildId, userId, datos) {
    const { tipo, titulo, anio, temporada, nota, texto, spoilers = false, meGusta = false } = datos || {};
    if (!TIPOS.has(tipo)) return { ok: false, motivo: "Eso no es una película ni una serie." };
    if (!String(titulo || "").trim()) return { ok: false, motivo: "Falta el título." };
    if (!notaValida(Number(nota))) return { ok: false, motivo: "La nota va de ½ a 5 estrellas, en medias." };
    if (!haVisto(guildId, userId, { tipo, titulo, anio })) return { ok: false, motivo: "Solo puedes valorar lo que has visto." };

    const clave = claveDe({ tipo, titulo, anio, temporada });
    const t = ahora();
    db.prepare(
        `INSERT INTO plex_resenas
            (guildId, userId, clave, tipo, titulo, anio, nota, texto, spoilers, me_gusta, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId, userId, clave) DO UPDATE SET
            nota = excluded.nota, texto = excluded.texto, spoilers = excluded.spoilers,
            me_gusta = excluded.me_gusta, actualizado_en = excluded.actualizado_en`,
    ).run(
        guildId,
        String(userId),
        clave,
        tipo,
        String(titulo).trim().slice(0, 200),
        anio ?? null,
        Number(nota),
        textoDe(texto),
        spoilers ? 1 : 0,
        meGusta ? 1 : 0,
        t,
        t,
    );
    return { ok: true, resena: de(guildId, userId, clave) };
}

/** Borra la reseña de una persona en un título. @returns {boolean} si había algo que borrar */
function borrar(guildId, userId, clave) {
    return (
        db.prepare("DELETE FROM plex_resenas WHERE guildId = ? AND userId = ? AND clave = ?").run(guildId, String(userId), clave).changes >
        0
    );
}

module.exports = { guardar, borrar, de, haVisto, normalizarFila };
