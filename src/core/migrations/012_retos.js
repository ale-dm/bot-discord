// ⚔️ Retos entre jugadores (systems/retos.js): apuestas 1 contra 1 a un partido, duelos de casino y porras. El
// dinero de cada participante se cobra al entrar y queda apuntado en retos_participantes hasta que el reto se
// resuelve (premio) o se devuelve.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS retos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL,             -- partido | duelo | porra
            estado TEXT NOT NULL,           -- pendiente | en_juego | abierta | cerrada | resuelto | devuelto
            creador TEXT NOT NULL,
            rival TEXT,                     -- partido y duelo
            cantidad INTEGER NOT NULL,      -- lo que pone cada participante
            guildId TEXT,
            channelId TEXT,
            messageId TEXT,                 -- el mensaje público del reto, para editarlo al resolverse
            match_id TEXT,                  -- partido
            eleccion TEXT,                  -- partido: home | draw | away, lo que dice el creador
            juego TEXT,                     -- duelo: ppt | dados | blackjack
            pregunta TEXT,                  -- porra
            opciones TEXT,                  -- porra: JSON con las opciones
            datos TEXT,                     -- duelo: la partida (JSON)
            resultado TEXT,                 -- cómo acabó, en texto
            creado_en INTEGER NOT NULL,
            actualizado_en INTEGER NOT NULL,
            expira_en INTEGER,
            resuelto_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_retos_estado ON retos(estado);
        CREATE INDEX IF NOT EXISTS idx_retos_match ON retos(match_id);
        CREATE TABLE IF NOT EXISTS retos_participantes (
            reto_id INTEGER NOT NULL,
            userId TEXT NOT NULL,
            opcion TEXT,                    -- partido: a favor/en contra · porra: índice de la opción
            cantidad INTEGER NOT NULL,
            premio INTEGER,                 -- lo que recibió al cerrarse (NULL mientras sigue en juego)
            unido_en INTEGER NOT NULL,
            PRIMARY KEY (reto_id, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_retos_participantes_user ON retos_participantes(userId);
    `);
}

module.exports = { up };
