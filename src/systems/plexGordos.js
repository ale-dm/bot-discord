// 🎰 Roles por Gordos del Plex (F-PX-13): un rol al conseguir 1, 5 y 10 logros de Plex de dificultad 🎰 "Gordo del
// Plex". Los roles se eligen en Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos (plex.rol_gordos_1, _5 y _10) y
// se dan después de cada cálculo de los logros de Plex (cron cada 30 min y botón 📼 Sincronizar), como los roles de
// nivel: solo se dan, no se quitan. A quien ha ocultado sus logros de Plex no se le dan (se verían en su perfil).
const db = require("../core/db");
const guildSettings = require("./guildSettings");
const plexLinks = require("./plexLinks");
const plexTrofeos = require("./plexTrofeos");
const achievements = require("./achievementsSystem");
const { createLogger } = require("../core/logger");

const log = createLogger("Plex");

const UMBRALES = [1, 5, 10];

/** El rol de cada umbral (los que tengan uno elegido). @returns {Array<{ umbral: number, roleId: string }>} */
function roles(guildId) {
    const cfg = guildSettings.getSettings(guildId).plex;
    return UMBRALES.map((umbral) => ({ umbral, roleId: String(cfg[`rol_gordos_${umbral}`] || "") })).filter((r) => r.roleId);
}

/** Cuántos 🎰 Gordos del Plex tiene cada uno (logros de Plex completados de dificultad gordo). @returns {Map<userId, n>} */
function contar(guildId, userIds = null) {
    const gordos = achievements
        .getCatalog(guildId)
        .filter((a) => a.category === "plex" && a.dificultad === "gordo")
        .map((a) => a.id);
    const mapa = new Map();
    if (!gordos.length) return mapa;
    const filas = db
        .prepare(
            `SELECT userId, COUNT(*) AS n FROM achievements_progress
             WHERE guildId = ? AND completedAt IS NOT NULL AND achievementId IN (${gordos.map(() => "?").join(",")})
             GROUP BY userId`,
        )
        .all(guildId, ...gordos);
    for (const f of filas) if (!userIds || userIds.includes(f.userId)) mapa.set(f.userId, f.n);
    return mapa;
}

/** El siguiente umbral con rol que le falta a quien tiene `n` Gordos (null si no hay más). */
function siguiente(guildId, n) {
    return roles(guildId).find((r) => r.umbral > n) || null;
}

/**
 * Da a cada vinculado los roles de los umbrales a los que ha llegado y que no tiene. Necesita el servidor de Discord
 * (con el id solo, no hace nada). Nunca lanza. @returns {Promise<number>} roles dados
 */
async function repartir(guild) {
    if (!guild?.roles?.cache || !guild?.members) return 0;
    const config = roles(guild.id);
    if (!config.length) return 0;
    const links = plexLinks.getLinks(guild.id).filter((l) => !plexTrofeos.oculto(guild.id, l.discordUserId));
    const cuenta = contar(
        guild.id,
        links.map((l) => l.discordUserId),
    );
    let dados = 0;
    for (const link of links) {
        const n = cuenta.get(link.discordUserId) || 0;
        const tocan = config.filter((r) => n >= r.umbral);
        if (!tocan.length) continue;
        const member = guild.members.cache?.get(link.discordUserId) || (await guild.members.fetch?.(link.discordUserId)?.catch(() => null));
        if (!member) continue;
        for (const { umbral, roleId } of tocan) {
            if (member.roles?.cache?.has(roleId)) continue;
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                log.warn(`Rol de ${umbral} Gordos del Plex: el rol ${roleId} ya no existe en ${guild.name || guild.id}`);
                continue;
            }
            try {
                await member.roles.add(role);
                dados++;
                log.info(`Rol "${role.name}" (${umbral} 🎰 Gordos del Plex) dado a ${link.plexUsername || link.discordUserId}`);
            } catch (e) {
                // Normalmente: el rol está por encima del del bot o le falta "Gestionar roles".
                log.warn(`No se pudo dar el rol "${role.name}" (${umbral} 🎰) a ${link.discordUserId}: ${e.message}`);
            }
        }
    }
    return dados;
}

module.exports = { UMBRALES, roles, contar, siguiente, repartir };
