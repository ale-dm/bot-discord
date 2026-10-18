// Adaptador del recordatorio de logros sin reclamar (#472): a quién toca lo decide src/systems/logros/recordatorio; aquí
// se comprueba que el bot siga en el servidor, se pinta el embed y se manda el DM.
const recordatorio = require("../../systems/logros/recordatorio");
const { enviarAviso } = require("../../systems/avisosDm");
const { embedPendientes } = require("../mensajes/logrosPendientes");
const { createLogger } = require("../../core/logger");

const log = createLogger("Logros");

async function runLogrosPendientesJob(client) {
    const ahora = Date.now();
    let enviados = 0;
    for (const pendiente of recordatorio.avisosPendientes(ahora)) {
        const guild = client.guilds.cache.get(pendiente.guildId);
        if (!guild) continue;
        const payload = { embeds: [embedPendientes(guild, pendiente.claimable)] };
        if (!(await enviarAviso(client, pendiente.userId, "logros_pendientes", payload))) continue;
        recordatorio.marcarAviso(pendiente.guildId, pendiente.userId, ahora);
        enviados++;
    }
    log.info(`Recordatorio de logros sin reclamar: ${enviados} DMs enviados`);
}

module.exports = { runLogrosPendientesJob };
