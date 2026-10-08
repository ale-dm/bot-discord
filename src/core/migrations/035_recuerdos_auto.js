// Recuerdos automáticos del Duende (#15): lo que el Duende detecta en la conversación y propone guardar como nota de
// quien lo dijo. Un admin lo aprueba (pasa a ser una nota del perfil) o lo descarta. Ver systems/duende/recuerdosAuto.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS duende_recuerdos_propuestos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            nombre TEXT NOT NULL,
            texto TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | aprobado | descartado
            creada_en INTEGER NOT NULL,
            resuelta_por TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_duende_recuerdos_estado ON duende_recuerdos_propuestos (guildId, estado);
    `);
}

module.exports = { up };
