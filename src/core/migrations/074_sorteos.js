// Sorteos programados (#541): un sorteo por fila, con sus participantes y sus ganadores. El premio puede ser
// dinero (se reparte entre los ganadores) o un objeto del catálogo (si es único, solo puede haber un ganador).
// `estado`: activo → cerrado (con ganadores) o cancelado. Los cierres los revisa el cron cada minuto.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sorteos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            channelId TEXT NOT NULL,
            messageId TEXT,
            premioTipo TEXT NOT NULL,
            premioValor TEXT NOT NULL,
            premioNombre TEXT NOT NULL,
            ganadores INTEGER NOT NULL,
            rolId TEXT,
            nivel INTEGER NOT NULL DEFAULT 0,
            inicio INTEGER NOT NULL,
            fin INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'activo',
            creadorId TEXT NOT NULL
        )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_sorteos_estado ON sorteos (estado, fin)");
    db.exec(`
        CREATE TABLE IF NOT EXISTS sorteos_participantes (
            sorteoId INTEGER NOT NULL,
            userId TEXT NOT NULL,
            fecha INTEGER NOT NULL,
            PRIMARY KEY (sorteoId, userId)
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS sorteos_ganadores (
            sorteoId INTEGER NOT NULL,
            userId TEXT NOT NULL,
            cantidad INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (sorteoId, userId)
        )
    `);
}

module.exports = { up };
