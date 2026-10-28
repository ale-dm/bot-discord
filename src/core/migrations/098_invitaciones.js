// 📨 Recompensa por invitar (#522): quién invitó a cada miembro que entró con una invitación real (una sola vez por persona y
// servidor, aunque salga y vuelva), con qué código, en qué estado está (pendiente, madurada, inválida o salió) y lo que se
// pagó al madurar. Ver systems/invitaciones.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS invitaciones (
            guildId TEXT NOT NULL,
            invitadoId TEXT NOT NULL,
            invitadorId TEXT NOT NULL,
            codigo TEXT,
            entro_en INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            motivo TEXT,
            madurada_en INTEGER,
            recompensa INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, invitadoId)
        );
        CREATE INDEX IF NOT EXISTS idx_invitaciones_invitador ON invitaciones(guildId, invitadorId, estado);
        CREATE INDEX IF NOT EXISTS idx_invitaciones_estado ON invitaciones(estado, entro_en);
    `);
}

module.exports = { up };
