// 🔔 Aviso de que vuelve a estar disponible /trabajar o /robar (#434). Cuando uno de los dos responde con el cooldown, la
// respuesta lleva un botón «Avisarme»: al pulsarlo se guarda aquí el momento en que acaba, y un cron manda un DM al vencer,
// una sola vez. Es opt-in y por comando, y como vive en la base de datos sobrevive a un reinicio (al arrancar se envían los que
// vencieron mientras el bot estaba caído). Los DM pasan por /avisos (tipo «cooldown»).
const db = require("../core/db");
const { createLogger } = require("../core/logger");
const avisosDm = require("./avisosDm");

const log = createLogger("Avisos");

/** Los comandos con cooldown que ofrecen el aviso. */
const COMANDOS = { trabajar: "/trabajar", robar: "/robar" };

/** El momento (ms) en que acaba un cooldown al que le quedan `segundos`, redondeado al segundo siguiente. */
function momentoDeAviso(segundos, ahora = Date.now()) {
    return ahora + Math.ceil(Number(segundos) || 0) * 1000;
}

/**
 * Deja apuntado el aviso de `userId` para cuando acabe el cooldown de `comando` (en `cuando`, ms). `guildId` solo cuenta en
 * /trabajar (su cooldown es por servidor); /robar es global. Pulsar dos veces no crea dos avisos.
 * @returns {{ ok: true, nuevo: boolean, cuando: number } | { ok: false, mensaje: string }}
 */
function programar(userId, comando, guildId, cuando, ahora = Date.now()) {
    if (!COMANDOS[comando]) return { ok: false, mensaje: "❌ Ese comando no tiene avisos." };
    if (!(cuando > ahora)) return { ok: false, mensaje: `✅ Ya puedes volver a usar ${COMANDOS[comando]}.` };
    const gid = comando === "trabajar" ? String(guildId || "") : "";
    const r = db
        .prepare("INSERT OR IGNORE INTO avisos_cooldown (userId, comando, guildId, cuando) VALUES (?, ?, ?, ?)")
        .run(String(userId), comando, gid, cuando);
    return { ok: true, nuevo: r.changes === 1, cuando };
}

/** Los avisos que ya han vencido, del más antiguo al más reciente. */
function vencidos(ahora = Date.now()) {
    return db.prepare("SELECT userId, comando, guildId, cuando FROM avisos_cooldown WHERE cuando <= ? ORDER BY cuando").all(ahora);
}

/**
 * Manda los avisos vencidos (cron cada minuto y al arrancar). Cada aviso se borra antes de enviarlo, así que sale una sola
 * vez aunque el DM falle o el cron se solape. @returns {Promise<number>} DM enviados
 */
async function enviarVencidos(client, ahora = Date.now()) {
    const borrar = db.prepare("DELETE FROM avisos_cooldown WHERE userId = ? AND comando = ? AND guildId = ?");
    let enviados = 0;
    for (const f of vencidos(ahora)) {
        if (borrar.run(f.userId, f.comando, f.guildId).changes !== 1) continue;
        const servidor = f.guildId ? client.guilds?.cache?.get(f.guildId)?.name : null;
        const texto = `🔔 Ya puedes volver a usar **${COMANDOS[f.comando]}**${servidor ? ` en ${servidor}` : ""}.`;
        if (await avisosDm.enviarAviso(client, f.userId, "cooldown", texto)) enviados++;
    }
    if (enviados) log.info(`Avisos de cooldown: ${enviados} DM enviados`);
    return enviados;
}

module.exports = { COMANDOS, momentoDeAviso, programar, vencidos, enviarVencidos };
