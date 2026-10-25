// 📅 Recordatorios del calendario (#540): se miran cada minuto (y al arrancar, por si alguno tocaba con el bot apagado).
// Cada evento se recuerda una sola vez aunque el bot se reinicie (calendario_recordatorios).
const { cron } = require("../core/tareasRegistro");
const { runJob } = require("../core/interactionLog");
const { recordar } = require("../discord/envios/calendario");

function programarCalendario(client) {
    runJob("Recordatorios del calendario (arranque)", () => recordar(client));
    cron.schedule("* * * * *", () => runJob("Recordatorios del calendario", () => recordar(client)), { noOverlap: true });
}

module.exports = { programarCalendario };
