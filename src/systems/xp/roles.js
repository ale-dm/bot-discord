// Configuración de los roles de recompensa por nivel y las consultas que usan los adaptadores de Discord para darlos al
// subir, rellenar los que falten al arrancar (#472) y anunciar la subida.
const db = require("../../core/db");

/** Recompensas de los niveles que se cruzan al subir de `oldLevel` a `newLevel` (sin el de partida, con el nuevo). */
function recompensasPara(guildId, oldLevel, newLevel) {
    return db
        .prepare(
            `
        SELECT nivel, roleId, roleName FROM xp_role_rewards
        WHERE guildId = ? AND nivel > ? AND nivel <= ?
        ORDER BY nivel ASC
    `,
        )
        .all(guildId, oldLevel, newLevel);
}

/** El rol de recompensa de un nivel concreto, o undefined si no tiene. */
function recompensaDeNivel(guildId, nivel) {
    return db.prepare("SELECT roleId, roleName FROM xp_role_rewards WHERE guildId = ? AND nivel = ?").get(guildId, nivel);
}

/** Quiénes tienen nivel (para el relleno de roles pendientes al arrancar). */
function usuariosConNivel(guildId) {
    return db.prepare(`SELECT userId, nivel FROM xp_users WHERE guildId = ? AND nivel > 0`).all(guildId);
}

function getRewards(guildId) {
    return db
        .prepare(`SELECT nivel, roleId, roleName, descripcion, emoji FROM xp_role_rewards WHERE guildId = ? ORDER BY nivel ASC`)
        .all(guildId);
}

// Qué desbloquea un rol de recompensa (se muestra en /perfil). Vacío = rol de rango, sin descripción.
function setRewardDescription(guildId, nivel, roleId, descripcion, emoji) {
    const r = db
        .prepare(`UPDATE xp_role_rewards SET descripcion = ?, emoji = ? WHERE guildId = ? AND nivel = ? AND roleId = ?`)
        .run(descripcion || null, emoji || null, guildId, nivel, roleId);
    return r.changes > 0;
}

function setReward(guildId, nivel, roleId, roleName) {
    db.prepare(
        `
        INSERT INTO xp_role_rewards (guildId, nivel, roleId, roleName)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guildId, nivel, roleId) DO UPDATE SET roleName = excluded.roleName
    `,
    ).run(guildId, nivel, roleId, roleName || null);
}

function removeReward(guildId, nivel, roleId = null) {
    if (roleId) {
        db.prepare(`DELETE FROM xp_role_rewards WHERE guildId = ? AND nivel = ? AND roleId = ?`).run(guildId, nivel, roleId);
    } else {
        db.prepare(`DELETE FROM xp_role_rewards WHERE guildId = ? AND nivel = ?`).run(guildId, nivel);
    }
}

module.exports = { getRewards, setRewardDescription, setReward, removeReward, recompensasPara, recompensaDeNivel, usuariosConNivel };
