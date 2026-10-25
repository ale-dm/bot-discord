// 🔁 Exchange de apuestas entre jugadores (#533): fachada. Reglas y límites en exchange/reglas.js, el libro y los cruces en
// exchange/libro.js y la liquidación en exchange/liquidar.js.
const reglas = require("./exchange/reglas");
const libro = require("./exchange/libro");
const liquidar = require("./exchange/liquidar");

module.exports = { ...reglas, ...libro, ...liquidar };
