// 🔊 Sonidos avanzados (#297, #325, #326, #328, #329): contador de reproducciones, categoría y volumen de cada sonido (los que ya
// hay quedan sin categoría, a 100 % y a 0 usos), los roles que pueden usar un sonido (sin filas = de todos) y el sonido que suena
// con cada evento del bot (`ultimo_en` es el último disparo, para no sonar más de una vez cada N minutos). Ver systems/sonidos/.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "sonidos", "categoria", "TEXT");
    addColumnIfMissing(db, "sonidos", "volumen", "INTEGER NOT NULL DEFAULT 100");
    addColumnIfMissing(db, "sonidos", "reproducciones", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`
        CREATE TABLE IF NOT EXISTS sonido_roles (
            sonidoId INTEGER NOT NULL,
            roleId TEXT NOT NULL,
            PRIMARY KEY (sonidoId, roleId)
        );
        CREATE TABLE IF NOT EXISTS sonidos_eventos (
            guildId TEXT NOT NULL,
            evento TEXT NOT NULL,
            sonidoId INTEGER NOT NULL,
            ultimo_en INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, evento)
        );
    `);
}

module.exports = { up };
