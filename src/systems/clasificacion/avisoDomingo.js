// 🔔 Aviso del domingo a quien va primero (#394): el domingo a las 20:00 (hora de Madrid), un DM a quien lo ha activado y va primero en
// alguna categoría de la clasificación de la semana en curso, con lo que cobraría el lunes si acabara ya. Solo al primero de cada
// categoría. Como mucho uno por persona y semana (se guarda la semana avisada); un DM que falla no corta el resto. Se activa en
// 👤 Perfil. Además, como todo DM, se puede apagar del todo en /avisos.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const clasificacion = require("../clasificacionSemanal");
const { enviarAviso } = require("../avisosDm");
const { createLogger } = require("../../core/logger");
const { momentoMadrid, lunesDe } = require("../../core/zonaMadrid");

const log = createLogger("Clasificación");

const activo = (guildId, userId) =>
    Boolean(db.prepare("SELECT activo FROM clasificacion_aviso WHERE guildId = ? AND userId = ?").get(guildId, String(userId))?.activo);

function fijar(guildId, userId, valor) {
    db.prepare(
        "INSERT INTO clasificacion_aviso (guildId, userId, activo) VALUES (?, ?, ?) ON CONFLICT(guildId, userId) DO UPDATE SET activo = excluded.activo",
    ).run(guildId, String(userId), valor ? 1 : 0);
}

/** Por persona, en qué categorías va primero ahora: Map(userId → [{ categoria, premio }]) de la semana en curso (de su lunes a `hoy`). */
function lideres(guildId, hoy) {
    const semana = { lunes: lunesDe(hoy), domingo: hoy };
    const g = clasificacion.ganadores(guildId, semana);
    const cfg = guildSettings.getSettings(guildId).clasificacion;
    const porPersona = new Map();
    for (const c of clasificacion.CATEGORIAS) {
        if (!g[c.id]) continue;
        const lista = porPersona.get(String(g[c.id].userId)) || [];
        lista.push({ categoria: c, premio: clasificacion.premioDe(cfg, c.id) });
        porPersona.set(String(g[c.id].userId), lista);
    }
    return { semana, porPersona };
}

/**
 * Cron (domingos 20:00): manda el aviso a quien toque. `crearMensaje(lista)` pone el texto (viene de src/discord/mensajes).
 * @returns {Promise<number>} DMs enviados
 */
async function avisarLideres(client, crearMensaje, ahora = Date.now()) {
    const { dia } = momentoMadrid(ahora);
    let enviados = 0;
    for (const guild of client.guilds.cache.values()) {
        if (!guildSettings.getSettings(guild.id).clasificacion.canal) continue;
        const { semana, porPersona } = lideres(guild.id, dia);
        for (const [userId, lista] of porPersona) {
            const fila = db
                .prepare("SELECT activo, ultima_semana FROM clasificacion_aviso WHERE guildId = ? AND userId = ?")
                .get(guild.id, userId);
            if (!fila?.activo || fila.ultima_semana === semana.lunes) continue;
            try {
                if (await enviarAviso(client, userId, "clasificacion_domingo", crearMensaje(lista))) {
                    db.prepare("UPDATE clasificacion_aviso SET ultima_semana = ? WHERE guildId = ? AND userId = ?").run(
                        semana.lunes,
                        guild.id,
                        userId,
                    );
                    enviados++;
                }
            } catch (e) {
                log.warn(`No se pudo avisar a ${userId} de la clasificación del domingo: ${e.message}`);
            }
        }
    }
    log.info(`Aviso del domingo de la clasificación: ${enviados} DMs enviados`);
    return enviados;
}

module.exports = { activo, fijar, lideres, avisarLideres };
