// Los logros desbloqueados se anuncian (mencionando a quien lo consigue) en el mismo canal que las subidas de nivel,
// 874776941000020018: se pone como canal de logros (Config Global → Logros) en el servidor que lo usa para los
// niveles. Después se puede cambiar desde el panel.
const CANAL = "874776941000020018";

function up(db, { log }) {
    const guilds = db
        .prepare("SELECT DISTINCT guildId FROM xp_config WHERE clave = 'xp_announce_channel_id' AND valor = ?")
        .pluck()
        .all(CANAL);
    for (const guildId of guilds) {
        db.prepare(
            `INSERT INTO guild_settings (guildId, key, value) VALUES (?, 'logros.notify_channel_id', ?)
             ON CONFLICT(guildId, key) DO UPDATE SET value = excluded.value`,
        ).run(guildId, CANAL);
        log.info(`${guildId}: los logros se anuncian en ${CANAL}`);
    }
    if (!guilds.length) log.warn(`Ningún servidor usa ${CANAL} para los niveles: el canal de logros se pone en Config Global → Logros`);
}

module.exports = { up };
