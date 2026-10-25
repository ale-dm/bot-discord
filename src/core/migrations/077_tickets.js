// 🎫 Tickets de soporte (#537): cada ticket es un hilo privado en el canal de tickets entre su autor y el staff.
// `estado`: abierto → cerrado (por el autor o el staff, con transcripción en el canal de logs) o perdido (el hilo
// desapareció sin cerrarse: no cuenta para la espera de 1 hora). Queda quién lo abrió, quién lo cerró y cuándo.
// El índice único parcial impide dos tickets abiertos de la misma persona aunque pulse dos veces a la vez.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            autorId TEXT NOT NULL,
            categoria TEXT NOT NULL,
            asunto TEXT NOT NULL DEFAULT '',
            threadId TEXT,
            mensajeId TEXT,
            estado TEXT NOT NULL DEFAULT 'abierto',
            abiertoEn INTEGER NOT NULL,
            cerradoEn INTEGER,
            cerradoPor TEXT
        )
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_uno_abierto ON tickets (guildId, autorId) WHERE estado = 'abierto'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_autor ON tickets (guildId, autorId, estado, cerradoEn)");
}

module.exports = { up };
