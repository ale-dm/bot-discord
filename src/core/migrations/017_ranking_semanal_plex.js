// 🍿 El ranking semanal de Plex (systems/plexRankingSemanal.js) se publica cada lunes en 874776941000020018 (el canal de
// las subidas de nivel y de los logros): se pone como canal del ranking en el servidor que lo usa. Después se puede
// cambiar desde Panel admin → Plex → 📣 Ranking semanal.
const CANAL = "874776941000020018";

function up(db, { log }) {
    const guilds = db
        .prepare(
            `SELECT guildId FROM xp_config WHERE clave = 'xp_announce_channel_id' AND valor = ?
             UNION SELECT guildId FROM guild_settings WHERE key = 'logros.notify_channel_id' AND value = ?`,
        )
        .pluck()
        .all(CANAL, CANAL);
    for (const guildId of guilds) {
        db.prepare(
            `INSERT INTO guild_settings (guildId, key, value) VALUES (?, 'plex.ranking_canal', ?)
             ON CONFLICT(guildId, key) DO UPDATE SET value = excluded.value`,
        ).run(guildId, CANAL);
        log.info(`${guildId}: el ranking semanal de Plex se publica en ${CANAL}`);
    }
    if (!guilds.length) log.warn(`Ningún servidor usa ${CANAL}: el canal del ranking semanal se pone en Panel admin → Plex`);
}

module.exports = { up };
