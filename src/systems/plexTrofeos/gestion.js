// 🍿 Trofeos de Plex: rarezas, ocultar, lo que se anuncia, y la gestión desde /paneladmin (crear, buscar, borrar).
const db = require("../../core/db");
const plexIdiomas = require("../plexIdiomas");
const plexLinks = require("../plexLinks");
const { PREFIJO, dificultadGuardada, log, normalizar } = require("./base");
const { cacheCatalogo, catalogo, trofeos } = require("./candidatos");
const { parsearCondicion, describirCondicion, ORDEN_TIPO } = require("./condiciones");
const { limpiarNombre } = require("./nombres");

/** Qué % de los vinculados a Plex tiene cada logro de Plex. @returns {Map<string, number>} achievementId → % */
function rarezas(guildId) {
    const links = plexLinks.getLinks(guildId);
    const mapa = new Map();
    if (!links.length) return mapa;
    const ids = links.map((l) => l.discordUserId);
    const filas = db
        .prepare(
            `SELECT achievementId, COUNT(*) AS n FROM achievements_progress
             WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId LIKE 'plex%' AND userId IN (${ids.map(() => "?").join(",")})
             GROUP BY achievementId`,
        )
        .all(guildId, ...ids);
    for (const f of filas) mapa.set(f.achievementId, Math.max(1, Math.round((f.n / links.length) * 100)));
    return mapa;
}
function textoRareza(pct) {
    if (!pct) return "nadie lo tiene todavía";
    return pct <= 10 ? `solo el ${pct} % del servidor lo tiene` : `lo tiene el ${pct} % del servidor`;
}
/** Para el anuncio: a cada logro de Plex se le añade su dificultad y, a los trofeos (fases 2 y 3), de qué son y lo raros
 * que son. */
function paraAnuncio(guildId, desbloqueados) {
    if (!desbloqueados.some((a) => a.trofeo || a.dificultad)) return desbloqueados;
    const r = rarezas(guildId);
    return desbloqueados.map((a) => {
        const partes = a.trofeo ? [a.desc, textoRareza(r.get(a.id))] : [];
        if (a.dificultad) partes.push(plexIdiomas.textoDificultad(a.dificultad));
        return partes.length ? { ...a, detalleAnuncio: partes.join(" · ") } : a;
    });
}
function oculto(guildId, userId) {
    return Boolean(db.prepare("SELECT ocultar FROM plex_preferencias WHERE guildId = ? AND userId = ?").get(guildId, userId)?.ocultar);
}
/**
 * Qué logros de Plex se ven en el perfil de alguien (para listUserAchievements y getSummary): ninguno si los ha ocultado
 * y no es su perfil; solo los que ya tiene si no tiene la cuenta de Plex vinculada (los fijos de Plex no le dicen nada).
 */
function opcionesPerfil(guildId, userId, propio) {
    if (!propio && oculto(guildId, userId)) return { excluirCategorias: ["plex"] };
    if (!plexLinks.getLinkByDiscordId(guildId, userId)) return { ocultarPendientes: ["plex"] };
    return {};
}
function setOculto(guildId, userId, valor) {
    db.prepare(
        `INSERT INTO plex_preferencias (guildId, userId, ocultar) VALUES (?, ?, ?)
         ON CONFLICT(guildId, userId) DO UPDATE SET ocultar = excluded.ocultar`,
    ).run(guildId, userId, valor ? 1 : 0);
    log.info(`${userId} ${valor ? "oculta" : "enseña"} sus logros de Plex en ${guildId}`);
}
/** Crea un trofeo de admin (dificultad: fácil, normal —por defecto— o gordo). @returns {{ ok: true, trofeo } | { ok: false, error }} */
function crearAdmin(guildId, { nombre, descripcion, condicion, recompensa, dificultad }, actorId) {
    const p = parsearCondicion(condicion);
    if (!p.ok) return p;
    const n = limpiarNombre(nombre);
    if (!n) return { ok: false, error: "Falta el nombre." };
    const coins = Math.floor(Number(String(recompensa ?? "").replace(/\./g, "")));
    if (!Number.isFinite(coins) || coins < 0 || coins > 1_000_000)
        return { ok: false, error: "La recompensa tiene que ser un número entre 0 y 1.000.000." };
    const dif = plexIdiomas.leerDificultad(dificultad);
    if (!dif) return { ok: false, error: "La dificultad tiene que ser fácil, normal o gordo (el Gordo del Plex)." };
    // Id único aunque se creen dos en el mismo milisegundo.
    const existe = db.prepare("SELECT 1 FROM plex_trofeos WHERE guildId = ? AND id = ?");
    let id = `admin:${Date.now().toString(36)}`;
    for (let i = 2; existe.get(guildId, id); i++) id = `admin:${Date.now().toString(36)}-${i}`;
    const trofeo = {
        guildId,
        id,
        tipo: "admin",
        nombre: n,
        descripcion:
            String(descripcion || "")
                .trim()
                .slice(0, 200) || describirCondicion(p.cond),
        objetivo: p.cond.n || 1,
        recompensa: coins,
        dificultad: dif,
        condicion: p.texto,
        creado: Date.now(),
        creado_por: actorId || null,
    };
    db.prepare(
        `INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, dificultad, condicion, creado, creado_por)
         VALUES (@guildId, @id, @tipo, @nombre, @descripcion, @objetivo, @recompensa, @dificultad, @condicion, @creado, @creado_por)`,
    ).run(trofeo);
    cacheCatalogo.delete(guildId);
    log.info(`Trofeo de Plex creado en ${guildId} por ${actorId}: "${n}" (${p.texto}, ${coins} monedas, ${dif})`);
    return { ok: true, trofeo };
}
/**
 * Los trofeos cuyo nombre, descripción o condición tiene un texto ("Breaking Bad", "Nolan"), primero las series, y quién
 * tiene cada uno (sin quien oculta sus logros de Plex). Para el Duende: "¿quién ha terminado Breaking Bad?".
 * @returns {Array<{ id, nombre, descripcion, tipo, dificultad, quienes: string[] }>}
 */
function buscar(guildId, texto, limite = 10) {
    const t = normalizar(texto);
    if (t.length < 2) return [];
    const quienes = db
        .prepare(
            "SELECT userId FROM achievements_progress WHERE guildId = ? AND achievementId = ? AND completedAt IS NOT NULL ORDER BY completedAt",
        )
        .pluck();
    return trofeos(guildId)
        .filter((x) => [x.nombre, x.descripcion, x.condicion].some((v) => normalizar(v).includes(t)))
        .sort((a, b) => ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo) || a.creado - b.creado)
        .slice(0, limite)
        .map((x) => ({
            id: PREFIJO + x.id,
            nombre: x.nombre,
            descripcion: x.descripcion,
            tipo: x.tipo,
            dificultad: dificultadGuardada(x),
            quienes: quienes.all(guildId, PREFIJO + x.id).filter((u) => !oculto(guildId, u)),
        }));
}
/** Borra un trofeo (y el progreso de cada uno en él; lo ya reclamado no se devuelve). */
function borrar(guildId, id) {
    const r = db.prepare("DELETE FROM plex_trofeos WHERE guildId = ? AND id = ?").run(guildId, id);
    db.prepare("DELETE FROM achievements_progress WHERE guildId = ? AND achievementId = ?").run(guildId, PREFIJO + id);
    cacheCatalogo.delete(guildId);
    return r.changes > 0;
}
/** Cuántos trofeos hay de cada tipo y de cada dificultad, y cuántas personas tienen cada uno de los de admin (para el
 * panel). */
function resumen(guildId) {
    const porTipo = Object.fromEntries(
        db
            .prepare("SELECT tipo, COUNT(*) AS n FROM plex_trofeos WHERE guildId = ? GROUP BY tipo")
            .all(guildId)
            .map((f) => [f.tipo, f.n]),
    );
    const porDificultad = { facil: 0, normal: 0, gordo: 0 };
    for (const t of catalogo(guildId)) porDificultad[t.dificultad]++;
    const quienes = new Map(
        db
            .prepare(
                `SELECT achievementId, COUNT(*) AS n FROM achievements_progress
                 WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId LIKE 'plext:admin:%' GROUP BY achievementId`,
            )
            .all(guildId)
            .map((f) => [f.achievementId.slice(PREFIJO.length), f.n]),
    );
    return {
        porTipo,
        porDificultad,
        admin: trofeos(guildId, "admin").map((t) => ({ ...t, dificultad: dificultadGuardada(t), completados: quienes.get(t.id) || 0 })),
    };
}

module.exports = { rarezas, textoRareza, paraAnuncio, oculto, opcionesPerfil, setOculto, crearAdmin, buscar, borrar, resumen };
