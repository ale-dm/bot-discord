// Adaptador de los avisos de racha (#472): a quién toca avisar lo decide src/systems/xp/rachas; aquí se comprueba que el
// bot siga en el servidor, se pinta el embed y se manda el DM.
const rachas = require("../../systems/xp/rachas");
const { enviarAviso } = require("../../systems/avisosDm");
const { buildStreakWarningEmbed, buildStreakLostEmbed } = require("../mensajes/rachas");
const { createLogger } = require("../../core/logger");

const log = createLogger("XP");

async function runStreakWarningJob(client) {
    const rows = rachas.avisosRachaPeligro();
    let enviados = 0;
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        if (await enviarAviso(client, row.userId, "racha_peligro", { embeds: [buildStreakWarningEmbed(guild, row.streakDias)] }))
            enviados++;
    }
    log.info(`Aviso de racha en peligro: ${enviados}/${rows.length} DMs enviados`);
}

/** DM único al perder una racha de 3 días o más (#342), y luego borra la XP diaria vieja. */
async function runStreakLostJob(client) {
    const hoy = rachas.madridDateStr();
    const rows = rachas.avisosRachaPerdida(hoy);
    let enviados = 0;
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        if (await enviarAviso(client, row.userId, "racha_perdida", { embeds: [buildStreakLostEmbed(guild, row.streakDias)] })) enviados++;
    }
    log.info(`Aviso de racha perdida: ${enviados}/${rows.length} DMs enviados`);
    rachas.limpiarDiaria(hoy);
}

module.exports = { runStreakWarningJob, runStreakLostJob };
