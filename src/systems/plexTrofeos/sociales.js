// 🍿 Trofeos sociales y de estreno (F-PX-12) y el cálculo de los eventos de cada sincronización.
const db = require("../../core/db");
const plexIdiomas = require("../plexIdiomas");
const { PREFIJO, MAX_NOMBRES_IA, LOTE_IA, EVENTOS_FICHAS, normalizar, clavePelicula } = require("./base");
const { cacheCatalogo, trofeos, contexto, datosUsuario, estadisticasEntre, candidatos } = require("./candidatos");
const { rangoDe, parsearCondicion, evaluarCondicion } = require("./condiciones");
const { renombrar, crear } = require("./nombres");

/** Contadores fijos del catálogo (achievementsSystem, categoría plex) de los trofeos sociales. */
const EVENTOS_SOCIALES = { compartidas: "plex_cine_compartido", sinSpoilers: "plex_sin_spoilers", primero: "plex_primero" };
/** "Sin spoilers": verlo en las 24 h desde que llega a Plex. "Estreno": en su primera semana en Plex. */
const SIN_SPOILERS_S = 24 * 3600;
const ESTRENO_S = 7 * 24 * 3600;
/**
 * Lo social de cada vinculado, con la copia del historial de todos y cuándo llegó cada cosa a Plex (las fichas):
 *   - compartidas: veces que ha visto la misma película que otro vinculado el mismo día (en hora de Madrid).
 *   - sinSpoilers: episodios y películas distintos vistos en las 24 h desde que llegaron a Plex.
 *   - primero: estrenos (en su primera semana en Plex) que vio antes que nadie del servidor (vinculado o no).
 * Lo que no tiene la fecha de llegada (fichas de antes de guardarla) no cuenta para los dos últimos.
 * @returns {Map<string, { compartidas: number, sinSpoilers: number, primero: number }>} discordUserId → cuentas
 */
function sociales(guildId, links, ctx) {
    const { momento } = require("../plexHistorial");
    const porTautulli = new Map(links.map((l) => [String(l.tautulliUserId), l.discordUserId]));
    const cuentas = new Map(links.map((l) => [l.discordUserId, { compartidas: 0, sinSpoilers: new Set(), primero: 0 }]));
    if (!links.length) return new Map();
    const filas = db
        .prepare(
            `SELECT id, tautulliUserId, tipo, rating_key, serie_key, serie, titulo, anio, temporada, episodio, inicio
             FROM plex_reproducciones WHERE guildId = ? AND visto = 1`,
        )
        .all(guildId);
    const pelisPorDia = new Map(); // "día|película" → vinculados que la vieron ese día
    const primeraVista = new Map(); // cosa → la primera reproducción de un estreno { inicio, id, tautulliUserId }
    for (const f of filas) {
        const u = porTautulli.get(String(f.tautulliUserId));
        let cosa;
        let alta = null;
        if (f.tipo === "movie") {
            const ficha = ctx.peliculasPorKey.get(f.rating_key) || ctx.peliculasPorTitulo.get(clavePelicula(f.titulo, f.anio));
            cosa = `p|${ficha ? clavePelicula(ficha.titulo, ficha.anio) : clavePelicula(f.titulo, f.anio)}`;
            alta = ficha?.alta || null;
            if (u) {
                const k = `${momento(f.inicio).dia}|${cosa}`;
                if (!pelisPorDia.has(k)) pelisPorDia.set(k, new Set());
                pelisPorDia.get(k).add(u);
            }
        } else {
            if (f.temporada === null || f.episodio === null) continue;
            const porKey = ctx.seriesPorKey.get(f.serie_key);
            const ficha = porKey?.encontrada ? porKey : ctx.seriesPorTitulo.get(normalizar(f.serie)) || porKey;
            cosa = `e|${ficha?.rating_key || f.serie_key}|${f.temporada}:${f.episodio}`;
            alta = ficha?.altas?.[`${f.temporada}:${f.episodio}`] || null;
        }
        const desdeQueLlego = alta ? f.inicio - alta : null;
        if (desdeQueLlego === null || desdeQueLlego < 0 || desdeQueLlego > ESTRENO_S) continue;
        if (u && desdeQueLlego <= SIN_SPOILERS_S) cuentas.get(u).sinSpoilers.add(cosa);
        const antes = primeraVista.get(cosa);
        if (!antes || f.inicio < antes.inicio || (f.inicio === antes.inicio && f.id < antes.id)) primeraVista.set(cosa, f);
    }
    for (const usuarios of pelisPorDia.values()) if (usuarios.size >= 2) for (const u of usuarios) cuentas.get(u).compartidas++;
    for (const f of primeraVista.values()) {
        const u = porTautulli.get(String(f.tautulliUserId));
        if (u) cuentas.get(u).primero++;
    }
    return new Map([...cuentas].map(([u, c]) => [u, { compartidas: c.compartidas, sinSpoilers: c.sinSpoilers.size, primero: c.primero }]));
}

// ─── Evaluación ──────────────────────────────────────────────────────────────
/**
 * Los eventos de logros de cada vinculado que salen de las fichas: los contadores fijos (anime, series terminadas,
 * sociales), los trofeos automáticos que tiene (creándolos si es el primero) y su progreso en los de admin (los que
 * tienen fechas, con solo lo visto entre ellas).
 * @param {Array<{ discordUserId, tautulliUserId }>} links
 * @param {Map<string, object>} statsPorUsuario estadísticas de la fase 1 (plexHistorial.estadisticas) de cada uno
 * @returns {Promise<Map<string, Array<{ event: string, value: number }>>>} discordUserId → eventos
 */
async function eventosDe(guildId, links, statsPorUsuario = new Map()) {
    const ctx = contexto(guildId);
    const existentes = new Set(trofeos(guildId).map((t) => t.id));
    const admin = trofeos(guildId, "admin")
        .map((t) => ({ t, p: parsearCondicion(t.condicion) }))
        .filter((x) => x.p.ok);
    const nuevos = new Map();
    const objetivos = new Map();
    const porUsuario = new Map();
    const social = sociales(guildId, links, ctx);
    for (const link of links) {
        const datos = datosUsuario(guildId, link.tautulliUserId, ctx);
        const eventos = Object.entries(EVENTOS_FICHAS).map(([campo, event]) => ({ event, value: datos.cuentas[campo] }));
        for (const [modo, c] of Object.entries(datos.cuentas.idioma))
            for (const tipo of ["eps", "pelis", "series"]) eventos.push({ event: plexIdiomas.evento(tipo, modo), value: c[tipo] });
        const s = social.get(link.discordUserId);
        for (const [campo, event] of Object.entries(EVENTOS_SOCIALES)) eventos.push({ event, value: s[campo] });
        for (const c of candidatos(datos, ctx)) {
            if (!existentes.has(c.id) && !nuevos.has(c.id)) nuevos.set(c.id, c);
            eventos.push({ event: PREFIJO + c.id, value: 1 });
        }
        // Los de admin con fechas: con lo visto entre ellas (una vez por rango y persona).
        const porRango = new Map();
        for (const { t, p } of admin) {
            const rango = rangoDe(p.cond);
            let d = datos;
            let st = statsPorUsuario.get(link.discordUserId);
            if (rango) {
                const k = `${rango.desde}|${rango.hasta}`;
                if (!porRango.has(k))
                    porRango.set(k, {
                        datos: datosUsuario(guildId, link.tautulliUserId, ctx, rango),
                        stats: estadisticasEntre(guildId, link.tautulliUserId, rango),
                    });
                ({ datos: d, stats: st } = porRango.get(k));
            }
            const r = evaluarCondicion(p.cond, d, ctx, st);
            if (!r) continue;
            if (r.objetivo > 0) objetivos.set(t.id, r.objetivo);
            eventos.push({ event: PREFIJO + t.id, value: r.progreso });
        }
        porUsuario.set(link.discordUserId, eventos);
    }
    // Los nombres de Gemini que sobren del tope de esta sincronización, para los de antes que se quedaron sin él.
    const pedidos = nuevos.size ? await crear(guildId, [...nuevos.values()]) : [];
    await renombrar(guildId, Math.min(LOTE_IA, MAX_NOMBRES_IA - pedidos.length), new Set(pedidos));
    // El objetivo de "todas las de…" o "terminar una serie" cambia si se añaden películas o episodios.
    const cambiar = db.prepare("UPDATE plex_trofeos SET objetivo = ? WHERE guildId = ? AND id = ? AND objetivo != ?");
    let cambiados = 0;
    for (const [id, objetivo] of objetivos) cambiados += cambiar.run(objetivo, guildId, id, objetivo).changes;
    if (cambiados) cacheCatalogo.delete(guildId);
    return porUsuario;
}

// ─── Rareza, preferencias y admin ────────────────────────────────────────────

module.exports = { EVENTOS_SOCIALES, sociales, eventosDe };
