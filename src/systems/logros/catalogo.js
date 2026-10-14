// 🏅 Catálogo de logros (datos). El motor (aplicar eventos, reclamar, anunciar) está en systems/achievementsSystem.js;
// aquí solo se juntan las listas de cada categoría (systems/logros/datos/*.js, una fila por logro); los de idioma de Plex vienen
// de systems/plexIdiomas y se añaden al final.

const { SOCIAL } = require("./datos/social");
const { XP } = require("./datos/xp");
const { RACHA } = require("./datos/racha");
const { CASINO } = require("./datos/casino");
const { CRIPTO } = require("./datos/cripto");
const { TIENDA } = require("./datos/tienda");
const { PLEX } = require("./datos/plex");

// El orden importa (listados y trofeos): social, xp, racha, casino, cripto, tienda, Plex y, al final, los de idioma de Plex.
const CATALOG = [...SOCIAL, ...XP, ...RACHA, ...CASINO, ...CRIPTO, ...TIENDA, ...PLEX, ...require("../plexIdiomas").logrosFijos()];

module.exports = { CATALOG };
