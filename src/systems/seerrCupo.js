// Cupo diario de peticiones a Seerr por persona (#464): lo comparten el Duende (solicitar_contenido_seerr) y el 📥 de
// 🎯 Para ti, así que pedir por una vía gasta del mismo cupo que la otra. Se comprueba antes de pedir y solo se gasta
// cuando Seerr acepta la petición: una petición fallida no cuenta (#266).
const guildSettings = require("./guildSettings");
const seerrClient = require("../services/seerrClient");

const SCOPE = "seerr_request";

/** Cuándo se reinicia el cupo (el contador va por día UTC): la próxima medianoche UTC, en segundos Unix. */
function reinicio(ahora = Date.now()) {
    const d = new Date(ahora);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}

/** ¿Le queda cupo hoy? No gasta nada. Si no le queda, `reinicio` dice cuándo vuelve a tenerlo. */
function comprobar(guildId, userId) {
    const { dailyRequestLimit } = seerrClient.getConfig(guildId);
    const r = guildSettings.checkAndConsumeLimit(guildId, SCOPE, String(userId), { dailyLimit: dailyRequestLimit, consume: false });
    return r.ok ? { ok: true } : { ok: false, reinicio: reinicio() };
}

/** Gasta una petición del cupo de hoy (llamar solo cuando Seerr ya la ha aceptado). */
function gastar(guildId, userId) {
    const { dailyRequestLimit } = seerrClient.getConfig(guildId);
    guildSettings.checkAndConsumeLimit(guildId, SCOPE, String(userId), { dailyLimit: dailyRequestLimit });
}

module.exports = { SCOPE, comprobar, gastar, reinicio };
