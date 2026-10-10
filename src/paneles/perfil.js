// Pantallas de /perfil: 👤 Perfil (ficha de nivel, racha, dinero y próxima recompensa), 🏅 Logros (con páginas,
// secretos, filtro y reclamar), 🏆 Rankings (nivel, riqueza, casino, logros, TTCL y Plex en una pantalla),
// 🎭 Recompensas de nivel y 🍿 Plex (horas, idiomas y lo que le falta poco; se entra desde 👤 Perfil). La pestaña
// 💰 Economía está en paneles/economia. Antes eran /nivel y /logros.

const { buildLogros } = require("./perfil/logros");
const { buildPerfil, buildPlex, buildRecompensas } = require("./perfil/ficha");
const { buildRankings } = require("./perfil/rankings");

module.exports = { buildPerfil, buildRecompensas, buildLogros, buildRankings, buildPlex };
