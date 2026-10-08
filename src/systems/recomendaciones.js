// 🎯 Recomendaciones personales (#22): a partir de lo que cada uno ha visto en Plex (la copia del historial de Tautulli),
// se toman sus títulos más vistos de los últimos meses ("semillas"), se busca cada uno en Seerr (TMDB) y se piden a Seerr
// sus recomendaciones. Se descarta lo que ya ha visto y lo que ya está disponible en Plex. Lo que recomiendan más semillas
// sale primero. Cada sugerencia se puede pedir con 📥 (Seerr, a nombre de quien lo pide).
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const seerrClient = require("../services/seerrClient");

const DIAS_HISTORIAL = 180;
const SEMILLAS = 3;
const SUGERENCIAS = 5;
const DISPONIBLE = 5;
const PARCIAL = 4;

const norm = (t) =>
    String(t || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

/** Lo más visto de la persona en los últimos meses: [{ titulo, tipo: "movie" | "tv", segundos }], de más a menos. */
function semillas(guildId, tautulliUserId, { ahora = Date.now(), limite = SEMILLAS } = {}) {
    const desde = Math.floor(ahora / 1000) - DIAS_HISTORIAL * 86400;
    const filas = db
        .prepare(
            `SELECT tipo, serie, titulo, segundos FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND inicio >= ?`,
        )
        .all(guildId, String(tautulliUserId), desde);
    const porTitulo = new Map();
    for (const f of filas) {
        const titulo = f.tipo === "movie" ? f.titulo : f.serie || f.titulo;
        if (!titulo) continue;
        const clave = `${f.tipo === "movie" ? "movie" : "tv"}|${norm(titulo)}`;
        const actual = porTitulo.get(clave) || { titulo, tipo: f.tipo === "movie" ? "movie" : "tv", segundos: 0 };
        actual.segundos += f.segundos;
        porTitulo.set(clave, actual);
    }
    return [...porTitulo.values()].sort((a, b) => b.segundos - a.segundos).slice(0, limite);
}

/** Títulos que ya ha visto (normalizados), para no recomendárselos. */
function vistos(guildId, tautulliUserId) {
    const filas = db
        .prepare("SELECT DISTINCT tipo, serie, titulo FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ?")
        .all(guildId, String(tautulliUserId));
    return new Set(filas.map((f) => norm(f.tipo === "movie" ? f.titulo : f.serie || f.titulo)).filter(Boolean));
}

/** Las dependencias reales (Seerr). Se pueden cambiar en los tests. */
const reales = {
    async buscar(guildId, titulo, tipo) {
        const resultados = await seerrClient.searchMulti(guildId, titulo);
        const del = resultados.filter((r) => r.mediaType === tipo);
        const igual = del.find((r) => norm(r.titulo) === norm(titulo));
        return (igual || del[0] || null)?.tmdbId ?? null;
    },
    recomendar: (guildId, tipo, tmdbId) => seerrClient.recomendaciones(guildId, tipo, tmdbId),
};

/**
 * Sugerencias para una persona vinculada a Plex.
 * @returns {Promise<{ ok: boolean, motivo?: string, sugerencias: object[] }>}
 */
async function generar(guildId, discordId, deps = reales, { ahora = Date.now() } = {}) {
    const link = plexLinks.getLinkByDiscordId(guildId, String(discordId));
    if (!link) return { ok: false, motivo: "Tu cuenta de Plex no está vinculada. Pídele a un admin que te vincule.", sugerencias: [] };
    const semillasDe = semillas(guildId, link.tautulliUserId, { ahora });
    if (!semillasDe.length) return { ok: false, motivo: "No tienes historial reciente en Plex para recomendarte nada.", sugerencias: [] };

    const yaVistos = vistos(guildId, link.tautulliUserId);
    const puntuados = new Map();
    for (const [orden, semilla] of semillasDe.entries()) {
        const tmdbId = await deps.buscar(guildId, semilla.titulo, semilla.tipo);
        if (!tmdbId) continue;
        const recs = await deps.recomendar(guildId, semilla.tipo, tmdbId);
        for (const r of recs) {
            if (yaVistos.has(norm(r.titulo)) || r.estadoCodigo >= PARCIAL) continue;
            const clave = `${r.mediaType}|${r.tmdbId}`;
            const actual = puntuados.get(clave) || { ...r, votos: 0, orden: orden, porque: [] };
            actual.votos += 1;
            actual.porque.push(semilla.titulo);
            puntuados.set(clave, actual);
        }
    }
    const sugerencias = [...puntuados.values()]
        .sort((a, b) => b.votos - a.votos || a.orden - b.orden || String(a.titulo).localeCompare(String(b.titulo)))
        .slice(0, SUGERENCIAS);
    return { ok: true, sugerencias };
}

/** Pide una sugerencia en Seerr a nombre de quien la ha pedido (su perfil de Seerr por Discord). */
async function pedir(guildId, discordId, mediaType, tmdbId) {
    const usuario = await seerrClient.resolveSeerrUserByDiscordId(guildId, discordId);
    if (!usuario) return { ok: false, mensaje: "No encuentro tu perfil de Seerr: pide a un admin que lo vincule a tu Discord." };
    try {
        await seerrClient.createRequest(guildId, { mediaType, tmdbId, userId: usuario.id });
        return { ok: true };
    } catch (e) {
        return { ok: false, mensaje: `No se pudo pedir en Seerr: ${e.message}` };
    }
}

module.exports = { DISPONIBLE, PARCIAL, semillas, vistos, generar, pedir, norm };
