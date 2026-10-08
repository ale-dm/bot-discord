// Plex Wrapped (#23) por DM: qué mes ya se le ha mandado a cada persona, para no repetirlo si el bot se reinicia a mitad.
// Ver systems/plexWrapped.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_wrapped_enviados (
            guildId TEXT NOT NULL,
            tautulliUserId TEXT NOT NULL,
            mes TEXT NOT NULL,
            enviado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, tautulliUserId, mes)
        );
    `);
}

module.exports = { up };
