// ⭐ Adaptador del DM de reseñas (#566): pide la nota de lo que cada persona ha terminado de ver. La lógica de a quién
// preguntar está en systems/plexResenas/pedidos.
const avisosDm = require("../../systems/avisosDm");
const pedidos = require("../../systems/plexResenas/pedidos");
const { mensajeResena } = require("../mensajes/resena");
const { createLogger } = require("../../core/logger");

const log = createLogger("Plex").child("Reseñas");

/**
 * Manda el DM a quien toque. Si no se puede (DMs cerrados), se apunta como cerrado para no reintentarlo cada media hora.
 * @returns {Promise<number>} DMs enviados
 */
async function avisarPendientes(client) {
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        for (const pendiente of pedidos.pendientes(guild.id)) {
            const id = pedidos.registrar(pendiente);
            if (!id) continue;
            const ok = await avisosDm.enviarAviso(client, pendiente.userId, "plex_resenas", mensajeResena({ ...pendiente, id }));
            if (ok) enviados++;
            else {
                pedidos.marcar(id, "cerrado");
                log.info(`Reseñas: no se pudo avisar a ${pendiente.userId} de «${pendiente.titulo}»; ¿DMs cerrados?`);
            }
        }
    }
    if (enviados) log.info(`Reseñas: ${enviados} avisos enviados`);
    return enviados;
}

module.exports = { avisarPendientes };
