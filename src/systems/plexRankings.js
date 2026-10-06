// 🍿 Rankings de Plex para /perfil → 🏆 Rankings (F-PX-10): más logros de Plex, más 🎰 Gordos del Plex, más horas
// (este mes y de siempre) y más políglota (logros de idioma completados). Solo cuentan los vinculados. Quien ha
// ocultado sus logros de Plex no sale en los de logros; en los de horas sí, como en el ranking semanal (no son logros).
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const plexTrofeos = require("./plexTrofeos");
const plexHistorial = require("./plexHistorial");
const achievements = require("./achievementsSystem");

const PUESTOS = 5;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const deIdioma = (a) => String(a.event || "").startsWith("plex_idioma_") || a.trofeo === "idioma";

/** Los primeros de una cuenta (Map userId → n), de más a menos; solo con algo. */
function primeros(mapa) {
    return [...mapa.entries()]
        .filter(([, n]) => n > 0)
        .map(([discordUserId, n]) => ({ discordUserId, n }))
        .sort((a, b) => b.n - a.n || a.discordUserId.localeCompare(b.discordUserId))
        .slice(0, PUESTOS);
}

/** Segundos vistos por cada vinculado (todo, o desde el día `desde` AAAA-MM-DD en hora de Madrid). */
function segundos(guildId, links, desde = null) {
    const porTautulli = new Map(links.map((l) => [String(l.tautulliUserId), l.discordUserId]));
    const mapa = new Map(links.map((l) => [l.discordUserId, 0]));
    const ph = links.map(() => "?").join(",");
    if (!desde) {
        const filas = db
            .prepare(
                `SELECT tautulliUserId, SUM(segundos) AS s FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId IN (${ph})
                 GROUP BY tautulliUserId`,
            )
            .all(guildId, ...porTautulli.keys());
        for (const f of filas) mapa.set(porTautulli.get(String(f.tautulliUserId)), f.s);
        return mapa;
    }
    // Un día de margen (la hora de Madrid no es UTC); luego se filtra por el día en Madrid.
    const margen = Date.parse(`${desde}T00:00:00Z`) / 1000 - 86400;
    const filas = db
        .prepare(
            `SELECT tautulliUserId, inicio, segundos FROM plex_reproducciones WHERE guildId = ? AND inicio >= ? AND tautulliUserId IN (${ph})`,
        )
        .all(guildId, margen, ...porTautulli.keys());
    for (const f of filas) {
        if (plexHistorial.momento(f.inicio).dia < desde) continue;
        const u = porTautulli.get(String(f.tautulliUserId));
        mapa.set(u, mapa.get(u) + f.segundos);
    }
    return mapa;
}

/**
 * Los cinco rankings de Plex de un servidor. null si nadie tiene Plex vinculado.
 * @returns {{ logros, gordos, poliglota, horasMes, horasSiempre, mes: string } | null} cada lista: [{ discordUserId, n }]
 */
function rankings(guildId, ahora = Date.now()) {
    const links = plexLinks.getLinks(guildId);
    if (!links.length) return null;
    const visibles = links.filter((l) => !plexTrofeos.oculto(guildId, l.discordUserId)).map((l) => l.discordUserId);
    const catalogo = achievements.getCatalog(guildId).filter((a) => a.category === "plex");
    const tipos = {
        logros: new Set(catalogo.map((a) => a.id)),
        gordos: new Set(catalogo.filter((a) => a.dificultad === "gordo").map((a) => a.id)),
        poliglota: new Set(catalogo.filter(deIdioma).map((a) => a.id)),
    };
    const cuentas = Object.fromEntries(Object.keys(tipos).map((k) => [k, new Map(visibles.map((u) => [u, 0]))]));
    if (visibles.length) {
        const filas = db
            .prepare(
                `SELECT userId, achievementId FROM achievements_progress
                 WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId LIKE 'plex%' AND userId IN (${visibles.map(() => "?").join(",")})`,
            )
            .all(guildId, ...visibles);
        for (const f of filas)
            for (const [k, ids] of Object.entries(tipos))
                if (ids.has(f.achievementId)) cuentas[k].set(f.userId, cuentas[k].get(f.userId) + 1);
    }
    const { dia } = plexHistorial.momento(Math.floor(ahora / 1000));
    const inicioMes = `${dia.slice(0, 7)}-01`;
    return {
        logros: primeros(cuentas.logros),
        gordos: primeros(cuentas.gordos),
        poliglota: primeros(cuentas.poliglota),
        horasMes: primeros(segundos(guildId, links, inicioMes)),
        horasSiempre: primeros(segundos(guildId, links)),
        mes: MESES[Number(dia.slice(5, 7)) - 1],
    };
}

module.exports = { PUESTOS, rankings };
