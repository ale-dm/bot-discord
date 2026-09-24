// Personalidades, perfiles de personas y personalidad por canal del Duende, que estaban en
// data/duende-personalities.json y data/duende-config.json (se reescribían enteros en cada
// cambio, no entraban en el backup de la BD y el perfil solo se podía editar a mano).
//
// Los perfiles se identifican por Discord ID. Los antiguos usaban el username (si alguien lo
// cambiaba, el Duende dejaba de reconocerle), así que se importan con discord_id vacío y el
// username; se vinculan a su ID al arrancar el bot o la primera vez que esa persona habla
// (ver src/systems/duende/perfiles.js). Los JSON se importan en perfiles.importarJsonSiExiste().
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS duende_personalidades (
            id TEXT PRIMARY KEY,
            titulo TEXT NOT NULL,
            instrucciones TEXT NOT NULL,
            actualizado_en INTEGER
        );
        CREATE TABLE IF NOT EXISTS duende_perfiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT UNIQUE,
            username TEXT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            notas TEXT NOT NULL DEFAULT '[]',
            actualizado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_duende_perfiles_username ON duende_perfiles (lower(username));
        CREATE TABLE IF NOT EXISTS duende_canales (
            channel_id TEXT PRIMARY KEY,
            personalidad_id TEXT NOT NULL
        );
    `);
}

module.exports = { up };
