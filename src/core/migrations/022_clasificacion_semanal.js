// Clasificación semanal con premios (F-EC-03): para saber quién ha sido el más activo de la semana hace falta la XP que
// tenía cada uno al empezarla. Aquí se guarda esa "foto" (se renueva cada lunes al publicar, ver
// systems/clasificacionSemanal.js). Se rellena ya con la XP de ahora, para que la primera semana cuente desde hoy.
const { hasColumn } = require("./index");

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS clasificacion_xp (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            xp_total INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, userId)
        );
    `);
    // Una BD muy antigua puede no tener aún xp_total: entonces no hay de dónde partir (la primera semana cuenta toda la XP).
    if (hasColumn(db, "xp_users", "xp_total")) {
        db.exec("INSERT OR IGNORE INTO clasificacion_xp (guildId, userId, xp_total) SELECT guildId, userId, xp_total FROM xp_users");
    }
}

module.exports = { up };
