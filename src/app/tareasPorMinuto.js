// ⏰ Tareas que miran cada pocos minutos si algo ha vencido: sorteos (#541), depósitos a plazo, roles temporales (#543) y
// las fases de las elecciones, los castigos del presidente y los sorteos de la lotería (#524), las subastas (#519), los préstamos entre jugadores (#520), los torneos de casino (#525), las carreras (#535) y el bingo (#528).
// Las programa app/tareas.js al arrancar; cada una va envuelta en runJob y sin solaparse.
const { cron } = require("../core/tareasRegistro");
const { runJob } = require("../core/interactionLog");
const avisarSorteos = require("../discord/envios/sorteos").revisar;
const avisarDepositos = require("../discord/envios/depositos").procesarYAvisar;
const rolesTemporales = require("../discord/envios/rolesTemporales");
const elecciones = require("../discord/envios/elecciones");
const presidencia = require("../discord/envios/presidencia");
const loteria = require("../discord/envios/loteria");
const subastas = require("../discord/envios/subastas");
const prestamosJugadores = require("../discord/envios/prestamosJugadores");
const torneos = require("../discord/envios/torneos");
const carreras = require("../discord/envios/carreras");
const bingo = require("../discord/envios/bingo");

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
    // 🔨 Subastas (#519): cada minuto se cierran las vencidas (al arrancar, las que vencieron con el bot apagado).
    runJob("Subastas (arranque)", () => subastas.revisar(client));
    cron.schedule("* * * * *", () => runJob("Subastas", () => subastas.revisar(client)), { noOverlap: true });
    // 🤝 Préstamos entre jugadores (#520): cobros de los vencidos, reintentos de las deudas, propuestas caducadas y avisos.
    runJob("Préstamos entre jugadores (arranque)", () => prestamosJugadores.revisar(client));
    cron.schedule("*/10 * * * *", () => runJob("Préstamos entre jugadores", () => prestamosJugadores.revisar(client)), { noOverlap: true });
    // 🏆 Torneos de casino (#525): empezar, cancelar sin gente, terminar con los premios y repintar la clasificación.
    runJob("Torneos de casino (arranque)", () => torneos.revisar(client));
    cron.schedule("* * * * *", () => runJob("Torneos de casino", () => torneos.revisar(client)), { noOverlap: true });
    // 🏇 Carreras (#535): abrir la siguiente, avisar 2 minutos antes y correrla cuando toca (al arrancar, las que pilló apagado).
    runJob("Carreras (arranque)", () => carreras.revisar(client));
    cron.schedule("* * * * *", () => runJob("Carreras", () => carreras.revisar(client)), { noOverlap: true });
    // 🎱 Bingo (#528): empezar las salas que agotan la espera (o cancelarlas) y terminar las que quedaron a medias.
    runJob("Bingo (arranque)", () => bingo.revisar(client));
    cron.schedule("* * * * *", () => runJob("Bingo", () => bingo.revisar(client)), { noOverlap: true });
}

module.exports = { programarVencimientos };
