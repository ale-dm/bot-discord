// 🎱 Bingo de sala (#528): la partida (dónde está su mensaje, quién la abrió, la entrada, el bote, el orden de las bolas que
// se fijó al empezar y quién ganó) y los jugadores con su cartón y su premio. Ver systems/bingo.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS bingo_partidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            channelId TEXT,
            messageId TEXT,
            abierta_por TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'esperando',
            entrada INTEGER NOT NULL,
            bote INTEGER NOT NULL DEFAULT 0,
            bolas TEXT,
            bola_ganadora INTEGER,
            creada INTEGER NOT NULL,
            cierra_espera INTEGER NOT NULL,
            empezada INTEGER,
            terminada INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_bingo_estado ON bingo_partidas(estado, cierra_espera);
        CREATE INDEX IF NOT EXISTS idx_bingo_guild ON bingo_partidas(guildId, estado);
        CREATE TABLE IF NOT EXISTS bingo_jugadores (
            partida_id INTEGER NOT NULL REFERENCES bingo_partidas(id),
            userId TEXT NOT NULL,
            carton TEXT NOT NULL,
            entro_en INTEGER NOT NULL,
            premio INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (partida_id, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_bingo_jugadores_usuario ON bingo_jugadores(userId, entro_en);
    `);
}

module.exports = { up };
