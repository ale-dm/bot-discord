// 🗳️ Elecciones a la presidencia del servidor: fachada de systems/elecciones/. Las reglas están repartidas por tema
// (ajustes, fases, candidatos, votos y poderes del presidente) y el SQL en los dos repositorios. Sin Discord.
const ajustes = require("./ajustes");
const fases = require("./fases");
const candidatos = require("./candidatos");
const votos = require("./votos");
const poderes = require("./poderes");
const repo = require("./repositorio");
const presidencia = require("./repositorioPresidencia");

module.exports = { ajustes, fases, candidatos, votos, poderes, repo, presidencia };
