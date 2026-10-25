// ⚠️ Avisos y strikes de moderación (#542): cada aviso del staff es un strike con su motivo. Nunca se borran: caducan por
// fecha (solo cuentan los de los últimos `moderacion.caducidad_dias`) o un admin los retira, y queda quién y cuándo.
// Fechas en ms.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS strikes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            staffId TEXT NOT NULL,
            motivo TEXT NOT NULL,
            creado INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'vigente',  -- vigente | retirado
            retiradoPor TEXT,
            retiradoEn INTEGER
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_strikes_usuario ON strikes (guildId, userId, estado, creado)");
}

module.exports = { up };
