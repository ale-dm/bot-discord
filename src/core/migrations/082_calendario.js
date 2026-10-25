// 📅 Calendario de eventos (#540): los eventos que crea un admin a mano (título y fecha, en ms) y qué recordatorios se han
// mandado ya (por la clave estable de cada evento), para no repetir ninguno tras un reinicio.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS calendario_eventos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            titulo TEXT NOT NULL,
            inicio INTEGER NOT NULL,
            creadoPor TEXT NOT NULL,
            creado INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS calendario_recordatorios (
            guildId TEXT NOT NULL,
            clave TEXT NOT NULL,
            enviado INTEGER NOT NULL,
            PRIMARY KEY (guildId, clave)
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_calendario_eventos ON calendario_eventos (guildId, inicio)");
}

module.exports = { up };
