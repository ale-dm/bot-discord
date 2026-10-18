// Adaptador del partido destacado del día (#472): enumera los servidores, busca el canal de resultados y envía el
// mensaje (embed y botones) que arma src/discord/mensajes/destacado. El sistema solo elige el partido.
const { elegir, HORA, momento } = require("../../systems/apuestas/destacado");
const guildSettings = require("../../systems/guildSettings");
const { mensajeDestacado } = require("../mensajes/destacado");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

/**
 * Cron y arranque: en cada servidor con el destacado activo y canal de resultados, si son las 10:00 o más y hoy no se ha
 * publicado, publica el de hoy. @returns {Promise<number>} servidores en los que se ha publicado
 */
async function publicarSiToca(client, ahora = Date.now()) {
    const { dia, hora } = momento(ahora);
    if (hora < HORA) return 0;
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).apuestas;
        if (!cfg.destacado || !cfg.canal_resultados || cfg.destacado_dia === dia) continue;
        const partido = elegir(ahora);
        if (!partido) {
            log.debug(`Partido destacado: hoy no queda ningún partido con cuotas (${guild.name})`);
            continue;
        }
        try {
            const canal =
                guild.channels.cache.get(cfg.canal_resultados) || (await guild.channels.fetch(cfg.canal_resultados).catch(() => null));
            if (!canal?.isTextBased?.()) {
                log.warn(`Partido destacado: el canal de resultados ${cfg.canal_resultados} de ${guild.name} no existe o no es de texto`);
                continue;
            }
            await canal.send(mensajeDestacado(partido));
            guildSettings.setSetting(guild.id, "apuestas.destacado_dia", dia);
            publicados++;
            log.info(
                `Partido destacado del ${dia} en ${guild.name}: ${partido.home_team} vs ${partido.away_team} (${partido.apuestas} apuestas)`,
            );
        } catch (e) {
            log.warn(`No se pudo publicar el partido destacado en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

module.exports = { publicarSiToca };
