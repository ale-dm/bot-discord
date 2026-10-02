// 🍿 Trofeos de Plex por idioma y por dificultad (systems/plexIdiomas.js): de cada reproducción vista, el idioma del
// audio y de los subtítulos (de get_stream_data de Tautulli, poco a poco), y la dificultad de cada trofeo creado
// (fácil, normal o "Gordo del Plex").
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "plex_reproducciones", "audio", "TEXT"); // es | lat | en | ja | otro | NULL (no se sabe)
    addColumnIfMissing(db, "plex_reproducciones", "subs", "TEXT"); // no | es | en | otro | NULL
    addColumnIfMissing(db, "plex_reproducciones", "idioma_revisado", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_plex_reproducciones_idioma ON plex_reproducciones(guildId, idioma_revisado)");
    addColumnIfMissing(db, "plex_trofeos", "dificultad", "TEXT"); // facil | normal | gordo
}

module.exports = { up };
