// Trofeos por país (#19): el identificador de TMDB de cada película (lo da Tautulli en sus guids, si lo tiene) y los países
// de producción que da TMDB (paises, JSON; null = todavía no se han pedido). Ver services/tmdbClient.js y
// systems/plexFichas.js (completarPaises).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "plex_fichas", "tmdb", "TEXT");
    addColumnIfMissing(db, "plex_fichas", "paises", "TEXT");
}

module.exports = { up };
