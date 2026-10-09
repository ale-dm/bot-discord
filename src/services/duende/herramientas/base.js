const plexLinks = require("../../../systems/plexLinks");
const seerrClient = require("../../seerrClient");
const { resolveNameToDiscordId } = require("../../../systems/duende/personas");

// ─── Herramientas del Duende (function calling) ────────────────────────────
// Todas de solo lectura a propósito: el modelo puede CONSULTAR datos reales del
// bot, pero ninguna herramienta escribe/modifica nada. El userId/guildId que
// reciben viene siempre del contexto real de Discord (toolContext), nunca de
// algo que el modelo extraiga o invente del texto — así no hay forma de que
// alguien le pida a Duende el saldo o el nivel de otra persona y se lo dé.
// Las de 🧙 economía (F-DU-03) tampoco mueven dinero: solo PROPONEN (un reto, una
// apuesta o un préstamo) y la propuesta sale con botones debajo de la respuesta;
// el dinero solo se mueve si quien habla pulsa ✅ (juegos/retos/duende).
// ─── Herramientas de Plex/Tautulli ──────────────────────────────────────────
// Aquí sí se consulta actividad de OTRA persona (a quien se refiera "persona" en
// la pregunta), a diferencia de las herramientas de arriba que solo miran al que
// pregunta. Es intencional: es un grupo de amigos sin restricciones de privacidad
// entre ellos. La única persona nunca se resuelve por un ID que el modelo invente:
// siempre pasa por resolveNameToDiscordId() contra miembros reales del server, y
// de ahí por plexLinks (solo gente que el admin haya vinculado explícitamente).
function periodoADias(periodo) {
    const p = String(periodo || "semana").toLowerCase();
    if (p.includes("mes")) return 30;
    if (p.includes("año") || p.includes("ano") || p.includes("year")) return 365;
    if (p.includes("total") || p.includes("siempre") || p.includes("all")) return 0;
    return 7;
}

function formatFecha(unixSeconds) {
    const n = Number(unixSeconds);
    if (!n) return null;
    return new Date(n * 1000).toISOString().slice(0, 10);
}

function formatHoras(totalSeconds) {
    return Math.round(((Number(totalSeconds) || 0) / 3600) * 10) / 10;
}

function summarizeWatchHistory(rows) {
    const shows = new Map();
    const movies = [];
    for (const r of rows || []) {
        const ts = Number(r.date || r.started || 0);
        if (r.media_type === "episode") {
            const key = r.grandparent_title || r.title || "Desconocido";
            const cur = shows.get(key) || { episodios_vistos: 0, ultima_vez: 0 };
            cur.episodios_vistos += 1;
            if (ts > cur.ultima_vez) cur.ultima_vez = ts;
            shows.set(key, cur);
        } else {
            movies.push({ titulo: r.title, fecha: formatFecha(ts) });
        }
    }
    const series = [...shows.entries()]
        .map(([titulo, v]) => ({ titulo, episodios_vistos: v.episodios_vistos, ultima_vez: formatFecha(v.ultima_vez) }))
        .sort((a, b) => b.episodios_vistos - a.episodios_vistos);
    return { series, peliculas: movies };
}

async function resolverPersonaVinculada(nombre, ctx) {
    if (!ctx.guild) return { error: "Solo disponible en servidores." };
    const discordId = resolveNameToDiscordId(nombre, ctx.guild);
    if (!discordId) return { error: `No identifico a "${nombre}" entre los miembros del server.` };
    const link = plexLinks.getLinkByDiscordId(ctx.guildId, discordId);
    if (!link) return { error: `${nombre} no tiene su cuenta de Plex vinculada.` };
    return { discordId, link };
}

// Resuelve el usuario de Seerr correspondiente a un Discord ID *real* (nunca inventado por
// el modelo: siempre viene de ctx.userId o de resolveNameToDiscordId sobre un miembro real
// del server): primero por el Discord ID que tenga guardado en su propio perfil de Seerr, y
// si no lo tiene puesto ahí, por el vínculo de Plex ya existente.
async function resolverSeerrUsuarioPorId(discordId, guildId) {
    const porDiscord = await seerrClient.resolveSeerrUserByDiscordId(guildId, discordId);
    if (porDiscord) return porDiscord;
    const plexLink = plexLinks.getLinkByDiscordId(guildId, discordId);
    if (plexLink?.plexUsername) {
        const porPlex = await seerrClient.resolveSeerrUserByPlexUsername(guildId, plexLink.plexUsername);
        if (porPlex) return porPlex;
    }
    return null;
}

function proponer(ctx, propuesta) {
    if (!Array.isArray(ctx.propuestas)) return { error: "Esto solo se puede proponer por el chat de texto, con botones." };
    if (ctx.propuestas.length >= 3) return { error: "Ya has propuesto bastante en esta respuesta." };
    ctx.propuestas.push({ ...propuesta, userId: ctx.userId });
    return {
        propuesta_enviada: true,
        aviso: "Debajo de tu respuesta sale un mensaje con ✅ Acepto / ❌ No. Hasta que no lo acepte no se mueve dinero: no digas que ya está hecho.",
    };
}

const cantidadDe = (args) => Math.floor(Number(args?.cantidad));

const sinNegritas = (texto) => String(texto).replace(/\*\*/g, "");

module.exports = {
    periodoADias,
    formatFecha,
    formatHoras,
    summarizeWatchHistory,
    resolverPersonaVinculada,
    resolverSeerrUsuarioPorId,
    proponer,
    cantidadDe,
    sinNegritas,
};
