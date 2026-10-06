// 🍿 Plex: proteger la economía en la primera importación (F-PX-08) y trofeos sociales (F-PX-12).
//   - plex_importacion: de cada vinculado, desde cuándo y hasta cuándo se le está calculando lo antiguo (el historial
//     entero, las fichas y los idiomas que faltan). Lo que desbloquea en ese tiempo da menos monedas.
//   - achievements_progress.importado: 1 si el logro se desbloqueó durante la importación.
//   - plex_fichas.alta / altas: cuándo llegó a Plex cada película y cada episodio (added_at de Tautulli), para "Sin
//     spoilers" y "Primero del servidor".
const { addColumnIfMissing } = require("./index");

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS plex_importacion (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            inicio INTEGER NOT NULL,    -- ms: primer cálculo de sus logros de Plex
            fin INTEGER,                -- ms: cuando ya estaba todo lo antiguo calculado (NULL = importando)
            PRIMARY KEY (guildId, userId)
        );
    `);
    addColumnIfMissing(db, "achievements_progress", "importado", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "plex_fichas", "alta", "INTEGER"); // películas: unix (s) en que llegó a Plex
    addColumnIfMissing(db, "plex_fichas", "altas", "TEXT"); // series: JSON {"temporada:episodio": unix}
}

module.exports = { up };
