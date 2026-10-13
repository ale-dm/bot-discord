// 💡 Buzón de sugerencias (#428): cada idea con su número, su estado (pendiente, aceptada o descartada, con motivo opcional)
// y el mensaje del canal donde se vota, y un voto 👍 o 👎 por persona. Ver systems/sugerencias.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sugerencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            texto TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            motivo TEXT,
            channelId TEXT,
            messageId TEXT,
            creada_en INTEGER NOT NULL,
            resuelta_en INTEGER,
            resuelta_por TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sugerencias_estado ON sugerencias(guildId, estado);
        CREATE INDEX IF NOT EXISTS idx_sugerencias_user ON sugerencias(userId, creada_en);
        CREATE TABLE IF NOT EXISTS sugerencia_votos (
            sugerencia_id INTEGER NOT NULL,
            userId TEXT NOT NULL,
            voto INTEGER NOT NULL,
            votado_en INTEGER NOT NULL,
            PRIMARY KEY (sugerencia_id, userId)
        );
    `);
}

module.exports = { up };
