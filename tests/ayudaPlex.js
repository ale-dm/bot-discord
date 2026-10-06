// Ayudas para los tests de Plex que ponen los datos directamente en la BD (fichas, reproducciones y vínculos), como en
// plexTrofeosCasos.test.js. No es un test (Jest solo ejecuta *.test.js).
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");

let n = 0;
let filaId = 1;
/** Un servidor nuevo para cada test (la BD en memoria es la misma para todo el fichero). */
const nuevoGuild = (prefijo = "guild-plex") => `${prefijo}-${++n}`;

/** Unix (s) de un día y hora de Madrid (AAAA-MM-DD, hora). */
function madrid(dia, hora = 20, min = 0) {
    const [y, m, d] = dia.split("-").map(Number);
    // Madrid es UTC+2 de finales de marzo a finales de octubre y UTC+1 el resto: se prueba con las dos.
    for (const offset of [2, 1]) {
        const t = Date.UTC(y, m - 1, d, hora - offset, min) / 1000;
        const p = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Madrid",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(t * 1000));
        const x = Object.fromEntries(p.map((v) => [v.type, v.value]));
        if (`${x.year}-${x.month}-${x.day}` === dia && Number(x.hour) === hora) return t;
    }
    throw new Error(`Hora de Madrid imposible: ${dia} ${hora}`);
}

function ficha(g, f) {
    db.prepare(
        `INSERT OR REPLACE INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones,
                                             temporadas, encontrada, actualizada, alta, altas)
         VALUES (@g, @rating_key, @tipo, @titulo, @anio, @section_id, @biblioteca, @generos, @directores, @colecciones, @temporadas,
                 @encontrada, @actualizada, @alta, @altas)`,
    ).run({
        g,
        tipo: "movie",
        anio: null,
        section_id: "1",
        biblioteca: "Películas",
        encontrada: 1,
        actualizada: Date.now(),
        alta: null,
        ...f,
        generos: JSON.stringify(f.generos || []),
        directores: JSON.stringify(f.directores || []),
        colecciones: JSON.stringify(f.colecciones || []),
        temporadas: f.temporadas ? JSON.stringify(f.temporadas) : null,
        altas: f.altas ? JSON.stringify(f.altas) : null,
    });
}
const peli = (g, key, titulo, anio, extra = {}) => ficha(g, { rating_key: key, titulo, anio, ...extra });
const serie = (g, key, titulo, temporadas, extra = {}) =>
    ficha(g, { rating_key: key, tipo: "show", titulo, temporadas, section_id: "2", biblioteca: "Series", ...extra });

/** Una reproducción vista (1 h, con el idioma ya revisado y sin dato, si no se dice otra cosa). */
function ver(g, user, f) {
    const id = filaId++;
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio,
                                          inicio, segundos, porcentaje, visto, audio, subs, idioma_revisado)
         VALUES (@g, @id, @user, @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio, @segundos, 100, @visto,
                 @audio, @subs, @idioma_revisado)`,
    ).run({
        g,
        id,
        user: String(user),
        tipo: "movie",
        rating_key: null,
        serie_key: null,
        titulo: null,
        serie: null,
        temporada: null,
        episodio: null,
        anio: null,
        inicio: 1_780_000_000 + id,
        segundos: 3600,
        visto: 1,
        audio: null,
        subs: null,
        idioma_revisado: 1,
        ...f,
    });
    return id;
}
const verPeli = (g, user, key, titulo, anio, extra = {}) => ver(g, user, { rating_key: key, titulo, anio, ...extra });
const verEps = (g, user, serieKey, titulo, eps, extra = {}) =>
    eps.map(([t, e]) =>
        ver(g, user, {
            tipo: "episode",
            rating_key: `${serieKey}-${t}-${e}`,
            serie_key: serieKey,
            serie: titulo,
            temporada: t,
            episodio: e,
            ...extra,
        }),
    );

/** La lista de películas de la biblioteca ya repasada (para "todas las de…", sagas y el fin de la importación). */
const bibliotecaCompleta = (g) =>
    db
        .prepare(
            `INSERT INTO plex_sync (guildId, ultimo_inicio, biblioteca_revisada) VALUES (?, 0, ?)
             ON CONFLICT(guildId) DO UPDATE SET biblioteca_revisada = excluded.biblioteca_revisada`,
        )
        .run(g, Date.now());

/** Vincula a cada usuario n como disc-n ↔ Tautulli n (cuenta "un"). */
const vincular = (g, ...users) => users.forEach((u) => plexLinks.setLink(g, `disc-${u}`, String(u), `u${u}`));

module.exports = { db, nuevoGuild, madrid, ficha, peli, serie, ver, verPeli, verEps, bibliotecaCompleta, vincular };
