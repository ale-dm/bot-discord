// Lo que se dice al cerrar: el DM a quien cobra, el resumen público y el embed de resultados.

const avisosDm = require("../../avisosDm");
const { logWarn, logDebug } = require("../../../core/logger");

// Avisa por DM a quien haya cobrado algo. Best-effort: si tiene los DMs cerrados, se ignora.
async function avisarGanadores(client, pagos) {
    for (const p of pagos) {
        if (avisosDm.silenciado(p.userId, "apuesta_cobrada")) continue;
        try {
            const user = await client.users.fetch(p.userId);
            await user.send(
                p.reembolso
                    ? `↩️ Te he devuelto **${p.premio.toLocaleString("es")}** monedas: ${p.descripcion.replace(/^Reembolso: /, "")}.`
                    : `🏆 ¡Has ganado **${p.premio.toLocaleString("es")}** monedas con tu apuesta (${p.descripcion})!`,
            );
        } catch (e) {
            (e.code === 50007 ? logDebug : logWarn)(`[PAGARAPUESTAS] No se pudo avisar por DM a ${p.userId}: ${e.message}`);
        }
    }
}

/**
 * Publica los resultados de una liquidación en el canal de resultados de cada servidor que lo tenga configurado
 * (/paneladmin → ⚽ Apuestas). Best-effort: un canal que no existe o sin permisos se registra y se sigue.
 * @returns {Promise<number>} canales en los que se ha publicado
 */
async function anunciarResultados(client, resumen) {
    const embed = resultadosEmbed(resumen);
    if (!embed) return 0;
    const guildSettings = require("../../guildSettings");
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const canalId = guildSettings.getSettings(guild.id).apuestas.canal_resultados;
        if (!canalId) continue;
        try {
            const canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId).catch(() => null));
            if (!canal?.isTextBased?.()) {
                logWarn(`[PAGARAPUESTAS] El canal de resultados ${canalId} de ${guild.name} no existe o no es de texto`);
                continue;
            }
            await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
            publicados++;
        } catch (e) {
            logWarn(`[PAGARAPUESTAS] No se pudieron publicar los resultados en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

const { menciones, resultadosEmbed, resumenEmbed } = require("../../../discord/mensajes/apuestas");

module.exports = { avisarGanadores, menciones, resultadosEmbed, anunciarResultados, resumenEmbed };
