// Adaptador del Plex Wrapped mensual (#472): manda por DM el resumen privado de cada persona vinculada. Las reglas y
// los datos viven en src/systems/plexWrapped.
const plexWrapped = require("../../systems/plexWrapped");
const plexLinks = require("../../systems/plexLinks");
const plexHistorial = require("../../systems/plexHistorial");
const tautulli = require("../../services/tautulliClient");
const { adjuntoWrapped } = require("../mensajes/wrapped");
const { createLogger } = require("../../core/logger");

const log = createLogger("PlexWrapped");

/** Manda por DM el resumen de cada persona a la que le toca ese mes. Un DM fallido no para a los demás. */
async function enviarPorDm(client, guild, mes) {
    let enviados = 0;
    for (const pendiente of plexWrapped.pendientesDe(guild.id, mes)) {
        try {
            const usuario = await client.users.fetch(pendiente.discordUserId);
            const files = adjuntoWrapped(plexWrapped.graficoPersonal(pendiente.resumen));
            await usuario.send({ content: plexWrapped.mensajePersonal(pendiente.resumen), files, allowedMentions: { parse: [] } });
            plexWrapped.registrarEnviado(guild.id, pendiente.tautulliUserId, mes);
            enviados++;
        } catch (e) {
            log.debug(`No se pudo mandar el Plex Wrapped a ${pendiente.plexUsername} (DMs cerrados o error): ${e.message}`);
        }
    }
    return enviados;
}

async function enviar(client, ahora) {
    const { dia, hora } = plexHistorial.momento(Math.floor(ahora / 1000));
    if (!dia.endsWith("-01") || hora < plexWrapped.HORA) return 0;
    // El 1 de enero, además del mes (diciembre), el resumen del año entero (#381).
    const periodos = dia.endsWith("-01-01")
        ? [plexWrapped.mesAnterior(ahora), plexWrapped.anioAnterior(ahora)]
        : [plexWrapped.mesAnterior(ahora)];
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        if (!plexLinks.getLinks(guild.id).length) continue;
        const { url, apiKey } = tautulli.getConfig(guild.id);
        if (url && apiKey) {
            try {
                await plexHistorial.sincronizar(guild.id);
            } catch (e) {
                log.warn(`Plex Wrapped: no se pudo copiar lo último del historial de ${guild.name} (se usa lo que hay): ${e.message}`);
            }
        }
        for (const periodo of periodos) {
            try {
                enviados += await enviarPorDm(client, guild, periodo);
            } catch (e) {
                log.warn(`No se pudo mandar el Plex Wrapped (${periodo.mes}) en ${guild.name}: ${e.message}`);
            }
        }
    }
    log.info(`Plex Wrapped ${periodos.map((p) => p.mes).join(" y ")}: ${enviados} resúmenes enviados por DM`);
    return enviados;
}

let enCurso = null;

/** Cron (cada hora) y arranque: el día 1 desde las 10:00 (Madrid), manda el resumen del mes anterior a cada persona. */
function enviarSiToca(client, ahora = Date.now()) {
    if (!enCurso) enCurso = enviar(client, ahora).finally(() => (enCurso = null));
    return enCurso;
}

module.exports = { enviarPorDm, enviarSiToca };
