// 🍿 Historial de Plex para los logros. Copia lo que ve cada uno (historial de Tautulli → plex_reproducciones) y con
// esa copia calcula los logros de la categoría "plex" (horas, películas, episodios, series, maratones...): cron cada
// 30 min en index.js y botón 📼 Sincronizar historial en /paneladmin → Plex. Solo cuenta a quien tiene la cuenta de
// Plex vinculada (plex_links), pero se guarda el historial de todos: si alguien se vincula después, ya está.
// La primera vez se importa el historial entero: lo que sale de golpe se anuncia en un solo mensaje por persona.
// Después de copiar, se piden las fichas que falten (systems/plexFichas) para los trofeos de las fases 2 y 3.
const db = require("../core/db");
const tautulli = require("../services/tautulliClient");
const plexLinks = require("./plexLinks");
const achievements = require("./achievementsSystem");
const plexFichas = require("./plexFichas");
const plexIdiomas = require("./plexIdiomas");
const plexTrofeos = require("./plexTrofeos");
const plexImportacion = require("./plexImportacion");
const plexGordos = require("./plexGordos");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

const PAGINA = 1000;
// Tope de seguridad (500.000 reproducciones) por si Tautulli devolviera páginas llenas sin fin.
const MAX_PAGINAS = 500;
const TIPOS = new Set(["movie", "episode"]);
// Lo que cuenta como "ver algo de madrugada": empezar entre las 3 y las 6 (hora de Madrid) y verlo al menos 10 min.
const NOCHE = { desde: 3, hasta: 6, minSegundos: 10 * 60 };

/** Cada estadística y el evento de logros al que va (todos con metric "max": el valor es el total actual). */
const EVENTOS = {
    horas: "plex_horas",
    peliculas: "plex_peliculas",
    episodios: "plex_episodios",
    series: "plex_series",
    maratonHoras: "plex_maraton",
    atracon: "plex_atracon",
    noches: "plex_noctambulo",
};

const numero = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const clave = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/** Una fila del historial de Tautulli como se guarda, o null si no cuenta (música, fotos, sin id...). */
function fila(guildId, r) {
    // El id de la fila: row_id en las versiones actuales de Tautulli; id en las antiguas.
    const id = numero(r.row_id) ?? numero(r.id);
    if (!TIPOS.has(r.media_type) || id === null || r.user_id === undefined) return null;
    const inicio = numero(r.started) ?? numero(r.date);
    if (!inicio) return null;
    return {
        guildId,
        id,
        tautulliUserId: String(r.user_id),
        tipo: r.media_type,
        rating_key: clave(r.rating_key),
        serie_key: r.media_type === "episode" ? clave(r.grandparent_rating_key) : null,
        titulo: r.title || r.full_title || null,
        serie: r.media_type === "episode" ? r.grandparent_title || null : null,
        temporada: numero(r.parent_media_index),
        episodio: numero(r.media_index),
        anio: numero(r.year),
        inicio,
        // play_duration en las versiones nuevas de Tautulli; antes, duration (los dos sin pausas).
        segundos: Math.max(0, numero(r.play_duration) ?? numero(r.duration) ?? 0),
        porcentaje: numero(r.percent_complete),
        visto: Number(r.watched_status) >= 1 ? 1 : 0,
    };
}

const { momentoMadrid } = require("../core/zonaMadrid");
/** Día (AAAA-MM-DD) y hora en Madrid de un instante unix en segundos. */
function momento(unix) {
    const { dia, hora } = momentoMadrid(unix * 1000);
    return { dia, hora };
}

/**
 * Copia a la BD las reproducciones nuevas de un servidor. La primera vez, el historial entero; después, desde dos días
 * antes de la última copiada (lo repetido se ignora).
 * @returns {Promise<{ nuevas: number, leidas: number, primera: boolean }>}
 */
async function sincronizar(guildId) {
    const sincronizacion = db.prepare("SELECT ultimo_inicio FROM plex_sync WHERE guildId = ?").get(guildId);
    const after = sincronizacion?.ultimo_inicio ? momento(sincronizacion.ultimo_inicio - 2 * 86400).dia : null;
    const insertar = db.prepare(
        `INSERT OR IGNORE INTO plex_reproducciones
            (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, porcentaje, visto)
         VALUES (@guildId, @id, @tautulliUserId, @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio,
                 @segundos, @porcentaje, @visto)`,
    );
    let nuevas = 0;
    let leidas = 0;
    let ultimo = sincronizacion?.ultimo_inicio || 0;
    const t0 = Date.now();
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const filas = await tautulli.getHistoryPage(guildId, { start: pagina * PAGINA, length: PAGINA, after });
        leidas += filas.length;
        db.transaction(() => {
            for (const r of filas) {
                const f = fila(guildId, r);
                if (!f) continue;
                nuevas += insertar.run(f).changes;
                if (f.inicio > ultimo) ultimo = f.inicio;
            }
        })();
        if (filas.length < PAGINA) break;
    }
    db.prepare(
        `INSERT INTO plex_sync (guildId, ultimo_inicio, ultima_sync) VALUES (?, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET ultimo_inicio = excluded.ultimo_inicio, ultima_sync = excluded.ultima_sync`,
    ).run(guildId, ultimo, Date.now());
    (nuevas ? log.info : log.debug)(
        `Historial de ${guildId}: ${nuevas} reproducciones nuevas de ${leidas} leídas${sincronizacion ? "" : " (primera importación)"} · ${Date.now() - t0} ms`,
    );
    return { nuevas, leidas, primera: !sincronizacion };
}

/** Cuántas reproducciones hay guardadas y cuándo se sincronizó por última vez (para el panel de admin). */
function estado(guildId) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM plex_reproducciones WHERE guildId = ?").get(guildId).n;
    const s = db.prepare("SELECT ultima_sync FROM plex_sync WHERE guildId = ?").get(guildId);
    return { reproducciones: n, ultimaSync: s?.ultima_sync || null };
}

/**
 * Lo que ha visto alguien: horas, películas y episodios vistos (sin contar repeticiones), series distintas con algún
 * episodio visto, el día con más horas (maratonHoras), más episodios de una misma serie en un día (atracon) y noches
 * distintas viendo algo de madrugada (noches). Los días, en hora de Madrid.
 */
function estadisticas(guildId, tautulliUserId) {
    const base = db
        .prepare(
            `SELECT COALESCE(SUM(segundos), 0) AS segundos,
                    COUNT(DISTINCT CASE WHEN tipo = 'movie' AND visto = 1 THEN rating_key END) AS peliculas,
                    COUNT(DISTINCT CASE WHEN tipo = 'episode' AND visto = 1 THEN rating_key END) AS episodios,
                    COUNT(DISTINCT CASE WHEN tipo = 'episode' AND visto = 1 THEN serie_key END) AS series
             FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ?`,
        )
        .get(guildId, String(tautulliUserId));
    const segundosPorDia = new Map();
    const episodiosPorDiaYSerie = new Map();
    const noches = new Set();
    const filas = db
        .prepare(
            "SELECT inicio, segundos, tipo, rating_key, serie_key, visto FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ?",
        )
        .iterate(guildId, String(tautulliUserId));
    for (const r of filas) {
        const { dia, hora } = momento(r.inicio);
        segundosPorDia.set(dia, (segundosPorDia.get(dia) || 0) + r.segundos);
        if (r.tipo === "episode" && r.visto && r.serie_key) {
            const k = `${dia}|${r.serie_key}`;
            if (!episodiosPorDiaYSerie.has(k)) episodiosPorDiaYSerie.set(k, new Set());
            episodiosPorDiaYSerie.get(k).add(r.rating_key);
        }
        if (hora >= NOCHE.desde && hora < NOCHE.hasta && r.segundos >= NOCHE.minSegundos) noches.add(dia);
    }
    return {
        horas: Math.floor(base.segundos / 3600),
        peliculas: base.peliculas,
        episodios: base.episodios,
        series: base.series,
        maratonHoras: Math.floor(Math.max(0, ...segundosPorDia.values()) / 3600),
        atracon: Math.max(0, ...[...episodiosPorDiaYSerie.values()].map((s) => s.size)),
        noches: noches.size,
    };
}

/**
 * Recalcula los logros de Plex de todos los vinculados de un servidor (el servidor o su id) y anuncia lo desbloqueado
 * en el canal de logros: un solo mensaje por persona con todo lo nuevo (al importar el historial pueden salir muchos
 * de golpe). Incluye los trofeos de las fases 2 y 3 (systems/plexTrofeos) con las fichas que ya haya. A quien ha
 * ocultado sus logros de Plex no se le anuncia nada. Lo que sale en la primera importación de cada uno da menos monedas
 * (systems/plexImportacion) y, con el servidor de Discord, se dan los roles de 🎰 Gordos del Plex (systems/plexGordos).
 * @returns {Promise<Array<{ discordUserId, stats, desbloqueados }>>}
 */
async function actualizarLogros(guildOrId) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId.id;
    const links = plexLinks.getLinks(guildId);
    const stats = new Map(links.map((l) => [l.discordUserId, estadisticas(guildId, l.tautulliUserId)]));
    let extra = new Map();
    // Con los logros de Plex desactivados no se crean trofeos (ni se le piden nombres a Gemini).
    if (achievements.categoriaActiva(guildId, "plex")) {
        try {
            extra = await plexTrofeos.eventosDe(guildId, links, stats);
        } catch (e) {
            log.error(`No se pudieron calcular los trofeos de Plex de ${guildId}:`, e);
        }
    }
    const resultado = [];
    for (const link of links) {
        const s = stats.get(link.discordUserId);
        const eventos = [
            ...Object.entries(EVENTOS).map(([campo, event]) => ({ event, value: s[campo] })),
            ...(extra.get(link.discordUserId) || []),
        ];
        // Lo que sale mientras se le calcula lo antiguo (su primera importación) da menos monedas.
        const importado = plexImportacion.importando(guildId, link.discordUserId);
        const desbloqueados = await achievements.applyEvents(guildOrId, link.discordUserId, eventos, { anunciar: false, importado });
        if (importado) plexImportacion.cerrarSiToca(guildId, link);
        resultado.push({ discordUserId: link.discordUserId, stats: s, desbloqueados, importado });
    }
    // Se anuncia después de calcular a todos, para que la rareza ("lo tiene el 8 %") cuente lo de esta vez.
    for (const { discordUserId, desbloqueados } of resultado) {
        if (desbloqueados.length && !plexTrofeos.oculto(guildId, discordUserId)) {
            await achievements.anunciarLogros(guildOrId, discordUserId, plexTrofeos.paraAnuncio(guildId, desbloqueados));
        }
    }
    // 🎰 Roles por Gordos del Plex (con el servidor de Discord; con el id solo no se pueden dar).
    if (typeof guildOrId !== "string") {
        try {
            await plexGordos.repartir(guildOrId);
        } catch (e) {
            log.warn(`No se pudieron dar los roles de Gordos del Plex en ${guildId}: ${e.message}`);
        }
    }
    return resultado;
}

/**
 * Copia lo nuevo del historial, pide las fichas y los idiomas que falten (sin pasarse de su presupuesto de llamadas) y
 * recalcula. `boton`: con los presupuestos más grandes del botón del panel.
 */
async function sincronizarYCalcular(guild, { boton = false } = {}) {
    const historial = await sincronizar(guild.id);
    let fichas = null;
    let idiomas = null;
    if (achievements.categoriaActiva(guild.id, "plex")) {
        try {
            fichas = await plexFichas.actualizar(guild.id, { presupuesto: plexFichas.PRESUPUESTO[boton ? "boton" : "cron"] });
        } catch (e) {
            log.warn(`No se pudieron actualizar las fichas de Plex de ${guild.name || guild.id}: ${e.message}`);
        }
        try {
            idiomas = await plexIdiomas.actualizar(guild.id, { presupuesto: plexIdiomas.PRESUPUESTO[boton ? "boton" : "cron"] });
        } catch (e) {
            log.warn(`No se pudieron revisar los idiomas de Plex de ${guild.name || guild.id}: ${e.message}`);
        }
    }
    const logros = await actualizarLogros(guild);
    return { historial, fichas, idiomas, logros };
}

/** Cron: sincroniza y recalcula en cada servidor con Tautulli configurado y alguien vinculado. */
async function sincronizarTodos(client) {
    for (const guild of client.guilds.cache.values()) {
        const { url, apiKey } = tautulli.getConfig(guild.id);
        if (!url || !apiKey || !plexLinks.getLinks(guild.id).length) continue;
        try {
            const { logros: r } = await sincronizarYCalcular(guild);
            const n = r.reduce((s, x) => s + x.desbloqueados.length, 0);
            if (n) log.info(`Logros de Plex en ${guild.name}: ${n} desbloqueados`);
        } catch (e) {
            log.warn(`No se pudo sincronizar el historial de Plex de ${guild.name}: ${e.message}`);
        }
    }
}

module.exports = { sincronizar, sincronizarYCalcular, sincronizarTodos, actualizarLogros, estadisticas, estado, momento, EVENTOS, PAGINA };
