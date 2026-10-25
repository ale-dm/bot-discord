// ⏰ Tareas que miran cada pocos minutos si algo ha vencido: sorteos (#541), depósitos a plazo y roles temporales (#543).
// Las programa app/tareas.js al arrancar; cada una va envuelta en runJob y sin solaparse.
const { cron } = require("../core/tareasRegistro");
const { runJob } = require("../core/interactionLog");
const avisarSorteos = require("../discord/envios/sorteos").revisar;
const avisarDepositos = require("../discord/envios/depositos").procesarYAvisar;
const rolesTemporales = require("../discord/envios/rolesTemporales");

function programarVencimientos(client) {
    cron.schedule("* * * * *", () => runJob("Sorteos", () => avisarSorteos(client)), { noOverlap: true });
    cron.schedule("*/5 * * * *", () => runJob("Depósitos a plazo", () => avisarDepositos(client)), { noOverlap: true });
    // ⏳ Al arrancar se quitan los roles temporales que vencieron con el bot apagado y, después, cada minuto.
    runJob("Roles temporales (arranque)", () => rolesTemporales.vencer(client));
    cron.schedule("* * * * *", () => runJob("Roles temporales", () => rolesTemporales.vencer(client)), { noOverlap: true });
}

module.exports = { programarVencimientos };
