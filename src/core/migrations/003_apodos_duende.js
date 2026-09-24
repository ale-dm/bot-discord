// Apodos del Duende en la BD (antes, dos mapas escritos a mano en duende.js).
// Los datos se cargan desde el panel o importando data/duende-apodos.seed.json al arrancar
// (ver systems/apodos.js → importarFicheroSiExiste).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS duende_apodos (
            guildId TEXT NOT NULL,
            apodo_norm TEXT NOT NULL,
            apodo TEXT NOT NULL,
            discordId TEXT NOT NULL,
            principal INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, apodo_norm)
        );
        CREATE INDEX IF NOT EXISTS idx_duende_apodos_persona ON duende_apodos (guildId, discordId);
    `);
}

module.exports = { up };
