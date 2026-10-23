// 🍿 A quién hay que preguntarle por una reseña: lo que ha terminado de ver después de activar la función, una vez por
// título y sin pasar el tope diario. `pendientes` solo consulta; `registrar` apunta el aviso y da el id de los botones.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const plexLinks = require("../plexLinks");
const avisosDm = require("../avisosDm");
const { clavePeli, anioDeClave } = require("./base");

const MAX_DIA = 5;
const VENTANA = 24 * 3600;

/** Lo que ha configurado el servidor (y sigue apagado por defecto). */
function config(guildId) {
    const plex = guildSettings.getSettings(guildId).plex;
    return {
        activo: Boolean(plex.resenas_activo),
        desde: Number(plex.resenas_desde) || 0,
        maxDia: Number(plex.resenas_max_dia) || MAX_DIA,
    };
}

/** Cuántos avisos se han mandado a esa persona en las últimas 24 h. */
function enviadosHoy(guildId, userId, ahora) {
    return db
        .prepare("SELECT COUNT(*) AS n FROM plex_resenas_pedidas WHERE guildId = ? AND userId = ? AND pedido_en >= ?")
        .get(guildId, String(userId), ahora - VENTANA).n;
}

/**
 * Las películas terminadas que aún no se le han preguntado a nadie, con el tope por persona y el global.
 * @returns {Array<{ guildId, userId, clave, titulo, anio }>}
 */
function pendientes(guildId, { ahora = Math.floor(Date.now() / 1000), limite = 10 } = {}) {
    const { activo, desde, maxDia } = config(guildId);
    if (!activo || !desde) return [];

    const yaResenada = db.prepare("SELECT 1 FROM plex_resenas WHERE guildId = ? AND userId = ? AND clave = ?");
    const yaPedida = db.prepare("SELECT 1 FROM plex_resenas_pedidas WHERE guildId = ? AND userId = ? AND clave = ?");
    const vistas = db.prepare(
        `SELECT titulo, anio FROM plex_reproducciones
         WHERE guildId = ? AND tautulliUserId = ? AND tipo = 'movie' AND (visto = 1 OR porcentaje >= 90) AND inicio >= ?
         ORDER BY inicio DESC`,
    );

    const salida = [];
    for (const link of plexLinks.getLinks(guildId)) {
        if (avisosDm.silenciado(link.discordUserId, "plex_resenas")) continue;
        const quedan = maxDia - enviadosHoy(guildId, link.discordUserId, ahora);
        if (quedan <= 0) continue;
        let puestos = 0;
        for (const f of vistas.all(guildId, String(link.tautulliUserId), desde)) {
            if (puestos >= quedan || salida.length >= limite) break;
            if (!f.titulo) continue;
            const clave = clavePeli(f.titulo, f.anio);
            if (yaResenada.get(guildId, link.discordUserId, clave) || yaPedida.get(guildId, link.discordUserId, clave)) continue;
            salida.push({ guildId, userId: link.discordUserId, clave, titulo: f.titulo, anio: f.anio });
            puestos++;
        }
    }
    return salida;
}

/** Apunta el aviso (para no repetirlo) y devuelve su id, el que va en los botones del DM. */
function registrar({ guildId, userId, clave, titulo }, ahora = Math.floor(Date.now() / 1000)) {
    db.prepare("INSERT OR IGNORE INTO plex_resenas_pedidas (guildId, userId, clave, titulo, pedido_en) VALUES (?, ?, ?, ?, ?)").run(
        guildId,
        String(userId),
        clave,
        String(titulo).slice(0, 200),
        ahora,
    );
    return db
        .prepare("SELECT id FROM plex_resenas_pedidas WHERE guildId = ? AND userId = ? AND clave = ?")
        .get(guildId, String(userId), clave)?.id;
}

/** El aviso por su id (para los botones y el formulario del DM). El año se saca de la clave. */
function pedido(id) {
    const fila = db.prepare("SELECT * FROM plex_resenas_pedidas WHERE id = ?").get(Number(id));
    return fila ? { ...fila, anio: anioDeClave(fila.clave) } : null;
}

/** Apunta qué decidió la persona: puntuada, pasada o cerrado (no se pudo mandar el DM). */
function marcar(id, decision) {
    db.prepare("UPDATE plex_resenas_pedidas SET decision = ? WHERE id = ?").run(decision, Number(id));
}

module.exports = { MAX_DIA, VENTANA, config, pendientes, registrar, pedido, marcar };
