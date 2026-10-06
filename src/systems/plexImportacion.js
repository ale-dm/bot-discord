// 🍿 Proteger la economía en la primera importación de Plex (F-PX-08). La primera vez que se calculan los logros de
// Plex de alguien sale de golpe todo lo que ha visto en años: decenas de logros. Lo que se desbloquea mientras se le
// calcula lo antiguo da solo una parte de las monedas al reclamarlo (plex.importacion_pct, por defecto el 50 %; se
// cambia en Panel admin → Plex → 🏆 Trofeos).
// "Lo antiguo" no se calcula de una vez: las fichas (series terminadas, sagas, directores) y los idiomas se piden poco a
// poco en cada sincronización. Por eso la importación de cada uno dura desde su primer cálculo hasta que ya no queda
// nada por revisar (fichas del servidor e idiomas de lo que ha visto), y como mucho 7 días.
const db = require("../core/db");
const plexFichas = require("./plexFichas");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

/** Lo que dura como mucho la importación de alguien, aunque Tautulli no haya terminado de dar lo antiguo. */
const MAX_MS = 7 * 24 * 3600 * 1000;

/** Si a alguien se le está calculando lo antiguo. Su primer cálculo empieza la importación. */
function importando(guildId, userId, ahora = Date.now()) {
    const fila = db.prepare("SELECT fin FROM plex_importacion WHERE guildId = ? AND userId = ?").get(guildId, String(userId));
    if (fila) return fila.fin === null;
    db.prepare("INSERT INTO plex_importacion (guildId, userId, inicio) VALUES (?, ?, ?)").run(guildId, String(userId), ahora);
    log.info(`Importación de Plex de ${userId} en ${guildId}: empieza (lo que desbloquee con lo antiguo da menos monedas)`);
    return true;
}

/** Lo que falta por revisar de lo antiguo de alguien: las fichas del servidor (null si no se ha repasado la biblioteca
 * todavía) y las reproducciones suyas sin idioma. */
function pendiente(guildId, tautulliUserId) {
    const f = plexFichas.estado(guildId);
    const idiomas = db
        .prepare("SELECT COUNT(*) FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND visto = 1 AND idioma_revisado = 0")
        .pluck()
        .get(guildId, String(tautulliUserId));
    return { fichas: f.bibliotecaRevisada ? f.pendientes : null, idiomas };
}

/**
 * Después de calcular a alguien que está importando: si ya está todo lo antiguo revisado (este cálculo ya lo ha
 * contado) o han pasado 7 días, su importación termina. @returns {boolean} si ha terminado ahora
 */
function cerrarSiToca(guildId, link, ahora = Date.now()) {
    const fila = db.prepare("SELECT inicio, fin FROM plex_importacion WHERE guildId = ? AND userId = ?").get(guildId, link.discordUserId);
    if (!fila || fila.fin !== null) return false;
    const p = pendiente(guildId, link.tautulliUserId);
    const hecho = p.fichas === 0 && p.idiomas === 0;
    if (!hecho && ahora - fila.inicio < MAX_MS) return false;
    db.prepare("UPDATE plex_importacion SET fin = ? WHERE guildId = ? AND userId = ?").run(ahora, guildId, link.discordUserId);
    log.info(
        `Importación de Plex de ${link.plexUsername || link.discordUserId} en ${guildId}: terminada` +
            (hecho ? "" : ` a los 7 días (quedaban ${p.fichas ?? "todas las"} fichas y ${p.idiomas} idiomas)`),
    );
    return true;
}

/** Si alguien se vuelve a vincular con otra cuenta de Plex, lo de esa cuenta es una importación nueva. */
function reiniciar(guildId, userId) {
    db.prepare("DELETE FROM plex_importacion WHERE guildId = ? AND userId = ?").run(guildId, String(userId));
}

/** Para el panel: cuántos vinculados están importando ahora. */
function cuantosImportando(guildId) {
    return db.prepare("SELECT COUNT(*) FROM plex_importacion WHERE guildId = ? AND fin IS NULL").pluck().get(guildId);
}

module.exports = { MAX_MS, importando, pendiente, cerrarSiToca, reiniciar, cuantosImportando };
