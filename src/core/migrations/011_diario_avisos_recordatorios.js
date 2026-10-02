// Recompensa diaria (🎁 Diario en /perfil → 💰 Economía), avisos de "ya está en Plex" de lo pedido en Seerr y
// recordatorio por DM antes de un partido al que se ha apostado.
const { addColumnIfMissing } = require("./index");

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recompensa_diaria (
            userId TEXT PRIMARY KEY,
            ultimo_dia TEXT NOT NULL,
            veces INTEGER NOT NULL DEFAULT 0,
            total INTEGER NOT NULL DEFAULT 0
        );
        -- Peticiones de Seerr ya avisadas como disponibles. requestId = 0 marca que el servidor ya tiene su base
        -- (la primera comprobación no avisa de todo lo que ya estaba disponible).
        CREATE TABLE IF NOT EXISTS seerr_avisos (
            guildId TEXT NOT NULL,
            requestId INTEGER NOT NULL,
            avisado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, requestId)
        );
    `);
    addColumnIfMissing(db, "apuestas_usuario", "recordado", "INTEGER NOT NULL DEFAULT 0");
}

module.exports = { up };
