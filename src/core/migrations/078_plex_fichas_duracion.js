// 🎲 Ruleta de películas (#576): la duración de cada película (plex_fichas.duracion, minutos; null = no se sabe), para el
// filtro de duración máxima. Sale del `duration` (ms) de get_metadata al pedir la ficha (systems/plexFichas/tautulli.js,
// fichaPelicula); las fichas que ya había se rellenan cuando se refrescan. Ver systems/plexRuleta.js.
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "plex_fichas", "duracion", "INTEGER");
}

module.exports = { up };
