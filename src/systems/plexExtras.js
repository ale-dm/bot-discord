// Cosas de /plex que hablan con Seerr y Tautulli: los estrenos de la semana (#299), lo que se reproduce ahora (#385) y las peticiones
// propias pendientes que se pueden cancelar (#410). Sin mensajes de Discord: los pintan paneles/plexExtras y src/perfil/plexExtras.
const seerrClient = require("../services/seerrClient");
const tautulliClient = require("../services/tautulliClient");
const plexLinks = require("./plexLinks");
const { momentoMadrid, sumarDias } = require("../core/zonaMadrid");
const { CacheLimitada } = require("../core/cacheLimitada");

const DIAS_ESTRENOS = 7;
const MAX_ESTRENOS = 5;
const CACHE_ESTRENOS_MS = 30 * 60 * 1000;
const cacheEstrenos = new CacheLimitada({ max: 50, ttlMs: CACHE_ESTRENOS_MS });

/**
 * Los estrenos de los próximos 7 días (hoy incluido) según Seerr, con 📥 para pedirlos: hasta 5, los de fecha más próxima. Se guarda
 * 30 minutos. Si la fuente no responde, devuelve el motivo en vez de una lista vacía.
 * @returns {Promise<{ ok: true, estrenos: object[], desde: string, hasta: string } | { ok: false, motivo: string }>}
 */
async function estrenosDeLaSemana(guildId, ahora = Date.now(), deps = seerrClient) {
    const desde = momentoMadrid(ahora).dia;
    const hasta = sumarDias(desde, DIAS_ESTRENOS - 1);
    const clave = `${guildId}|${desde}`;
    const guardado = cacheEstrenos.get(clave);
    if (guardado) return guardado;
    try {
        const todos = await deps.getEstrenos(guildId, desde, hasta);
        const resultado = { ok: true, estrenos: todos.slice(0, MAX_ESTRENOS), desde, hasta };
        cacheEstrenos.set(clave, resultado);
        return resultado;
    } catch (e) {
        return { ok: false, motivo: `No he podido consultar los estrenos en Seerr (${e.message}).` };
    }
}

/**
 * Lo que se está viendo ahora en Plex: [{ titulo, estado, progreso, discordUserId|null }]. Las cuentas sin vincular salen sin nombre.
 * @returns {Promise<{ ok: true, sesiones: object[] } | { ok: false, motivo: string }>}
 */
async function reproduciendoAhora(guildId, deps = { tautulliClient, plexLinks }) {
    let sesiones;
    try {
        sesiones = await deps.tautulliClient.getActivity(guildId);
    } catch (e) {
        return { ok: false, motivo: `No he podido consultar Tautulli (${e.message}).` };
    }
    const links = deps.plexLinks.getLinks(guildId);
    return {
        ok: true,
        sesiones: sesiones.map((s) => {
            const link = links.find((l) => String(l.tautulliUserId) === String(s.user_id));
            return {
                titulo: s.grandparent_title ? `${s.grandparent_title} - ${s.title}` : s.full_title || s.title || "algo",
                estado: s.state || "playing",
                progreso: Number(s.progress_percent) || 0,
                discordUserId: link?.discordUserId || null,
            };
        }),
    };
}

/**
 * Las peticiones pendientes de aprobación de una persona (#410).
 * @returns {Promise<{ ok: true, pedidos: object[] } | { ok: false, motivo: string }>}
 */
async function pedidosPendientes(guildId, discordId, deps = seerrClient) {
    try {
        const usuario = await deps.resolveSeerrUserByDiscordId(guildId, discordId);
        if (!usuario) return { ok: false, motivo: "No encuentro tu perfil de Seerr: pide a un admin que lo vincule a tu Discord." };
        return { ok: true, pedidos: await deps.getPeticionesPendientesDe(guildId, usuario.id) };
    } catch (e) {
        return { ok: false, motivo: `No he podido consultar Seerr (${e.message}).` };
    }
}

/**
 * Cancela una petición propia que sigue pendiente. Se comprueba contra Seerr justo antes: una ajena o ya aprobada no se toca. Si
 * Seerr falla al cancelar, la petición queda como estaba. No devuelve el cupo diario de peticiones.
 */
async function cancelarPedido(guildId, discordId, requestId, deps = seerrClient) {
    const lista = await pedidosPendientes(guildId, discordId, deps);
    if (!lista.ok) return { ok: false, mensaje: lista.motivo };
    const pedido = lista.pedidos.find((p) => Number(p.id) === Number(requestId));
    if (!pedido) return { ok: false, mensaje: "Esa petición ya no está pendiente (o no es tuya)." };
    try {
        await deps.cancelarPeticion(guildId, pedido.id);
        return { ok: true, mensaje: `🗑️ He cancelado tu petición de **${pedido.titulo}**.`, pedido };
    } catch (e) {
        return { ok: false, mensaje: `Seerr no ha podido cancelarla (${e.message}). Sigue como estaba.` };
    }
}

module.exports = { DIAS_ESTRENOS, MAX_ESTRENOS, estrenosDeLaSemana, reproduciendoAhora, pedidosPendientes, cancelarPedido };
