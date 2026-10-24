// 🛡️ Guardia del Duende (#553): el canal de voz en el que el bot se queda indefinidamente, quién la puso y desde
// cuándo. Una fila por servidor (como mucho una guardia a la vez). Sirve para volver a entrar al canal tras un reinicio;
// la fila se borra al dejar la guardia o si la conexión se cae.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS guardia_voz (
            guildId TEXT PRIMARY KEY,
            canalId TEXT NOT NULL,
            porUserId TEXT NOT NULL,
            creada_en INTEGER NOT NULL
        );
    `);
}

module.exports = { up };
