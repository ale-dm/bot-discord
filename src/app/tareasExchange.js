// 🔁 Exchange (#533): cada minuto (y al arrancar) se devuelve lo no cruzado de las órdenes de los partidos que ya han empezado,
// para que nunca quede dinero retenido sin contraparte con el balón en juego.
const { cron } = require("../core/tareasRegistro");
const { runJob } = require("../core/interactionLog");
const exchange = require("../systems/apuestas/exchange");

function programarExchange() {
    runJob("Exchange: órdenes de partidos empezados (arranque)", () => exchange.cerrarAlEmpezar());
    cron.schedule("* * * * *", () => runJob("Exchange: órdenes de partidos empezados", () => exchange.cerrarAlEmpezar()), {
        noOverlap: true,
    });
}

module.exports = { programarExchange };
