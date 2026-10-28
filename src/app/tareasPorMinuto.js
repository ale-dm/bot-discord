// ⏰ Tareas que miran cada pocos minutos si algo ha vencido: sorteos (#541), depósitos a plazo, roles temporales (#543) y
// las fases de las elecciones, los castigos del presidente y los sorteos de la lotería (#524).
// Las programa app/tareas.js al arrancar; cada una va envuelta en runJob y sin solaparse.
const { cron } = require("../core/tareasRegistro");
const { runJob } = require("../core/interactionLog");
const avisarSorteos = require("../discord/envios/sorteos").revisar;
const avisarDepositos = require("../discord/envios/depositos").procesarYAvisar;
const rolesTemporales = require("../discord/envios/rolesTemporales");
const elecciones = require("../discord/envios/elecciones");
const presidencia = require("../discord/envios/presidencia");
const loteria = require("../discord/envios/loteria");

function programarVencimientos(client) {
    cron.schedule("* * * * *", () => runJob("Sorteos", () => avisarSorteos(client)), { noOverlap: true });
    cron.schedule("*/5 * * * *", () => runJob("Depósitos a plazo", () => avisarDepositos(client)), { noOverlap: true });
    // ⏳ Al arrancar se quitan los roles temporales que vencieron con el bot apagado y, después, cada minuto.
    runJob("Roles temporales (arranque)", () => rolesTemporales.vencer(client));
    cron.schedule("* * * * *", () => runJob("Roles temporales", () => rolesTemporales.vencer(client)), { noOverlap: true });
    // 🗳️ Elecciones: las fases que acabaron con el bot apagado se cierran al arrancar y, después, cada minuto. Igual con los
    // silencios y sorderas del presidente que hay que revertir.
    runJob("Elecciones (arranque)", () => elecciones.revisar(client));
    cron.schedule("* * * * *", () => runJob("Elecciones", () => elecciones.revisar(client)), { noOverlap: true });
    runJob("Castigos del presidente (arranque)", () => presidencia.revertirSanciones(client));
    cron.schedule("* * * * *", () => runJob("Castigos del presidente", () => presidencia.revertirSanciones(client)), { noOverlap: true });
    // 🎟️ Lotería (#524): cada 5 minutos se celebran los sorteos cuya hora ha llegado; al arrancar, los que pilló el bot apagado.
    runJob("Lotería (arranque)", () => loteria.revisar(client));
    cron.schedule("*/5 * * * *", () => runJob("Lotería", () => loteria.revisar(client)), { noOverlap: true });
}

module.exports = { programarVencimientos };
