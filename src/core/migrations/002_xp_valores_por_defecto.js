// Antes, xpSystem "re-sembraba" en cada llamada: volvía a insertar los roles de recompensa por
// defecto (así que quitarlos desde el panel no servía), devolvía el cooldown de XP de 60 a 15 y
// usaba un canal de anuncios escrito en el código si no había uno configurado.
// Esta migración deja esos valores en la BD una única vez; a partir de aquí manda el panel.
//
// Solo afecta a los servidores que ya tenían configuración de XP. Uno nuevo empieza sin roles
// de recompensa ni canal de anuncios (se configuran en Panel admin → Niveles).

// Canal de anuncios que el código usaba cuando no había ninguno configurado.
const CANAL_ANUNCIOS_ANTERIOR = "874776941000020018";

function up(db, { log }) {
    const guilds = db.prepare("SELECT DISTINCT guildId FROM xp_config").pluck().all();

    for (const guildId of guilds) {
        // Canal de anuncios: se conserva el que se estaba usando de hecho.
        const canal = db.prepare("SELECT valor FROM xp_config WHERE guildId = ? AND clave = 'xp_announce_channel_id'").pluck().get(guildId);
        if (!canal) {
            db.prepare(
                `
                INSERT INTO xp_config (guildId, clave, valor) VALUES (?, 'xp_announce_channel_id', ?)
                ON CONFLICT(guildId, clave) DO UPDATE SET valor = excluded.valor
            `,
            ).run(guildId, CANAL_ANUNCIOS_ANTERIOR);
            log.info(`${guildId}: canal de anuncios de nivel fijado a ${CANAL_ANUNCIOS_ANTERIOR} (el que se usaba por defecto)`);
        }

        // Cooldown antiguo de 60 s que el código cambiaba a 15 en cada arranque.
        db.prepare("UPDATE xp_config SET valor = '15' WHERE guildId = ? AND clave = 'xp_message_cooldown_sec' AND valor = '60'").run(
            guildId,
        );
    }

    // Multiplicador de XP heredado de .env (XP_SLOWED_USER_ID): se siembra una sola vez.
    const legacyUser = String(process.env.XP_SLOWED_USER_ID || "").trim();
    if (legacyUser) {
        const mult = Math.max(1, Number(process.env.XP_SLOWED_USER_COST_MULTIPLIER || 3));
        for (const guildId of guilds) {
            db.prepare("INSERT OR IGNORE INTO xp_user_overrides (guildId, userId, costMultiplier) VALUES (?, ?, ?)").run(
                guildId,
                legacyUser,
                mult,
            );
        }
        log.info(`Multiplicador de XP heredado de .env sembrado para ${legacyUser} (x${mult})`);
    }
}

module.exports = { up };
