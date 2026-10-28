// 🃏 Póker Texas hold'em (#531): las mesas (dónde está su mensaje, quién la abrió, su estado y el botón), los asientos con las
// fichas de cada uno al empezar la mano (si un reinicio corta una mano, se devuelven esas) y las estadísticas de manos
// jugadas y ganadas. Ver systems/poker/mesas.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS poker_mesas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            channelId TEXT,
            messageId TEXT,
            abierta_por TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'esperando',
            boton INTEGER NOT NULL DEFAULT 0,
            manos INTEGER NOT NULL DEFAULT 0,
            creada INTEGER NOT NULL,
            cierra_espera INTEGER NOT NULL,
            cerrada_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_poker_mesas_estado ON poker_mesas(estado, cierra_espera);
        CREATE TABLE IF NOT EXISTS poker_asientos (
            mesa_id INTEGER NOT NULL REFERENCES poker_mesas(id),
            userId TEXT NOT NULL,
            fichas INTEGER NOT NULL,
            compra INTEGER NOT NULL,
            sentado_en INTEGER NOT NULL,
            fuera INTEGER NOT NULL DEFAULT 0,
            tiempos INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (mesa_id, userId)
        );
        CREATE TABLE IF NOT EXISTS poker_stats (
            userId TEXT PRIMARY KEY,
            manos INTEGER NOT NULL DEFAULT 0,
            ganadas INTEGER NOT NULL DEFAULT 0,
            fichas_ganadas INTEGER NOT NULL DEFAULT 0
        );
    `);
}

module.exports = { up };
