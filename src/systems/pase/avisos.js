// 📣 Avisos del pase: anunciar en un canal cuando alguien sube de nivel (#344) y avisar por DM, 24 horas antes de que acabe la temporada, de las
// recompensas sin cobrar (#348: al cambiar de temporada las de la anterior ya no se pueden cobrar). Se avisa, no se cobra solo: «🎁 Reclamar»
// sigue siendo a mano.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { fmtNumero } = require("../../core/formato");
const { enviarAviso } = require("../avisosDm");
const { monedasDelNivel } = require("./constantes");
const { ajustes, curvaDe } = require("./ajustes");
const { nivelDe } = require("./niveles");
const { temporadaDe } = require("./pase");

const log = createLogger("Pase");

/**
 * Publica en el canal del pase (`pase.canal_nivel`) que alguien ha subido de nivel. Sin canal configurado no hace nada; si el canal no existe
 * o no es de texto, lo deja en el log. Nunca lanza. @returns {Promise<boolean>} si lo publicó
 */
async function anunciarNivel(client, { guildId, userId, temporada, nivel }) {
    try {
        const canalId = ajustes(guildId).canalNivel;
        if (!canalId) return false;
        const guild = client.guilds.cache.get(guildId);
        const canal = guild?.channels?.cache?.get(canalId) || (await guild?.channels?.fetch?.(canalId).catch(() => null));
        if (!canal?.isTextBased?.()) {
            log.warn(`El canal del pase ${canalId} no existe o no es de texto en ${guild?.name || guildId}`);
            return false;
        }
        await canal.send({
            content: `🛡️ <@${userId}> ha subido al **nivel ${nivel}** del pase de batalla (temporada ${temporada + 1}). ¡Ya puedes reclamar en /pase!`,
            allowedMentions: { users: [String(userId)] },
        });
        return true;
    } catch (e) {
        log.warn(`No se pudo anunciar el nivel ${nivel} de ${userId} en ${guildId}: ${e.message}`);
        return false;
    }
}

/** Las horas antes del final de la temporada en que se avisa de lo que queda por cobrar. */
const HORAS_AVISO = 24;

/** Las recompensas alcanzadas y sin cobrar de cada persona con XP en una temporada: [{ guildId, userId, niveles, monedas }]. */
function sinCobrar(temporada) {
    const cobradosDe = db.prepare("SELECT nivel FROM pase_recompensas WHERE guildId = ? AND temporada = ? AND userId = ?");
    const resultado = [];
    for (const f of db.prepare("SELECT guildId, userId, xp FROM pase_progreso WHERE temporada = ? AND xp > 0").all(temporada)) {
        const cobrados = new Set(cobradosDe.all(f.guildId, temporada, f.userId).map((c) => c.nivel));
        const niveles = Array.from({ length: nivelDe(f.xp, curvaDe(f.guildId)) }, (_, i) => i + 1).filter((n) => !cobrados.has(n));
        if (niveles.length)
            resultado.push({ guildId: f.guildId, userId: f.userId, niveles, monedas: niveles.reduce((s, n) => s + monedasDelNivel(n), 0) });
    }
    return resultado;
}

function mensajeCierre(c, fin, nombreServidor) {
    const unix = Math.floor(fin / 1000);
    return (
        `🛡️ **Te quedan recompensas del pase por cobrar**${nombreServidor ? ` en ${nombreServidor}` : ""}: ` +
        `${c.niveles.length} ${c.niveles.length === 1 ? "nivel" : "niveles"} (**${fmtNumero(c.monedas)}** 🪙). ` +
        `La temporada acaba <t:${unix}:R> (<t:${unix}:f>) y entonces ya no se podrán cobrar. Entra en /pase → 🎁 Reclamar.`
    );
}

/**
 * Cron (cada hora) y arranque: en las últimas HORAS_AVISO horas de la temporada, avisa por DM a quien tenga niveles sin cobrar, una sola
 * vez por temporada, servidor y persona (se anota antes de mandar). Respeta /avisos y el pase desactivado.
 * @returns {Promise<number>} DMs enviados
 */
async function avisarSinCobrar(client, ahora = Date.now()) {
    const { numero, fin } = temporadaDe(ahora);
    if (fin - ahora > HORAS_AVISO * 3600 * 1000 || fin <= ahora) return 0;
    const marcar = db.prepare("INSERT OR IGNORE INTO pase_avisos_cierre (guildId, temporada, userId, enviado_en) VALUES (?, ?, ?, ?)");
    let enviados = 0;
    for (const c of sinCobrar(numero)) {
        if (!ajustes(c.guildId).activo || marcar.run(c.guildId, numero, c.userId, ahora).changes !== 1) continue;
        const nombre = client.guilds?.cache?.get(c.guildId)?.name;
        if (await enviarAviso(client, c.userId, "pase_recompensas", { content: mensajeCierre(c, fin, nombre) })) enviados++;
    }
    if (enviados) log.info(`Aviso de fin de temporada del pase: ${enviados} DMs`);
    return enviados;
}

module.exports = { HORAS_AVISO, anunciarNivel, sinCobrar, avisarSinCobrar };
