// 🎂 Cumpleaños (#427): el día y el mes (sin año) de cada persona en cada servidor, y a quién se ha felicitado ya cada año,
// para que el cron (que mira cada hora) publique una sola felicitación. Ver systems/cumpleanos.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cumpleanos (
            userId TEXT NOT NULL,
            guildId TEXT NOT NULL,
            dia INTEGER NOT NULL,
            mes INTEGER NOT NULL,
            PRIMARY KEY (userId, guildId)
        );
        CREATE TABLE IF NOT EXISTS cumpleanos_felicitados (
            userId TEXT NOT NULL,
            guildId TEXT NOT NULL,
            anio INTEGER NOT NULL,
            PRIMARY KEY (userId, guildId, anio)
        );
    `);
}

module.exports = { up };
