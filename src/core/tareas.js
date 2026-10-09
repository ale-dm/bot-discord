// ⏰ Tareas programadas del bot: avisos diarios y semanales, Plex, apuestas, cripto, negocios y copias de seguridad.
// Cada una va envuelta en runJob (registra errores y evita solapamientos). Se programan al arrancar (clientReady).
const cron = require("node-cron");
const { ActivityType } = require("discord.js");
const { createLogger } = require("./logger");
const alertas = require("../systems/alertas");
const xpSystem = require("../systems/xpSystem");
const tautulliClient = require("../services/tautulliClient");
const { runJob } = require("./interactionLog");
const pagarapuestas = require("../systems/apuestas/liquidacion");
const blackjack = require("../juegos/casino/blackjack.js");
const adivinar = require("../juegos/casino/adivinar.js");

const log = createLogger("Bot");
const Estado = process.env.ESTADOS ? process.env.ESTADOS.split(",") : ["Jugando"];

function actualizarActividad(client) {
    try {
        const actividad = Estado[Math.floor(Math.random() * Estado.length)];
        client.user.setPresence({
            activities: [{ name: actividad, type: ActivityType.Watching }],
            status: "online",
        });
        log.debug(`Actividad actualizada: ${actividad}`);
    } catch (err) {
        log.warn("Error actualizando la actividad:", err);
    }
}

function programarTareas(client) {
    runJob("Alertas pendientes del arranque", () => alertas.iniciar(client));
    actualizarActividad(client);
    setInterval(() => actualizarActividad(client), 5400000);
    setInterval(() => runJob("XP de voz", () => xpSystem.voiceTick(client)), 60000);
    cron.schedule("0 17 * * *", () => runJob("Aviso de rachas", () => xpSystem.runStreakWarningJob(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // Novedades de Plex y, después (para que el "Nuevo en Plex" salga antes), el aviso a quien lo pidió en Seerr. Al
    // final, el historial de Plex para los logros (la primera vez importa el historial entero: puede tardar).
    cron.schedule(
        "*/30 * * * *",
        async () => {
            await runJob("Novedades de Plex", () => tautulliClient.checkAllGuildsForNewContent(client));
            await runJob("Avisos de pedidos de Seerr", () => require("../systems/pedidosSeerr").avisarDisponibles(client));
            await runJob("Historial y logros de Plex", () => require("../systems/plexHistorial").sincronizarTodos(client), {
                slowMs: 120_000,
            });
        },
        { noOverlap: true },
    );
    // 🍿 Ranking semanal de Plex: los lunes desde las 10:00 (cada hora por si el bot estaba caído; solo una vez por
    // semana), y al arrancar por si es lunes y no se ha publicado.
    cron.schedule(
        "0 * * * 1",
        () => runJob("Ranking semanal de Plex", () => require("../systems/plexRankingSemanal").enviarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Ranking semanal de Plex (arranque)", () => require("../systems/plexRankingSemanal").enviarSiToca(client));
    // 🏆 Clasificación semanal con premios (el más rico, el más activo y el mejor apostador): igual, los lunes desde las 10:00.
    cron.schedule(
        "0 * * * 1",
        () => runJob("Clasificación semanal", () => require("../systems/clasificacionSemanal").publicarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Clasificación semanal (arranque)", () => require("../systems/clasificacionSemanal").publicarSiToca(client));
    // 🔴 Apuestas en directo (#12): refresca cada 10 minutos las cuotas de las competiciones con partidos en juego.
    // Solo con ODDS_DIRECTO=1 (cada refresco gasta créditos de la Odds API).
    cron.schedule("*/10 * * * *", () => runJob("Cuotas en directo", () => require("../services/oddsApi").refrescarEnDirecto()), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 🎞️ Plex Wrapped: el día 1 de cada mes, desde las 10:00 (Madrid), el resumen del mes anterior (cada hora, y al arrancar).
    cron.schedule("0 * * * *", () => runJob("Plex Wrapped", () => require("../systems/plexWrapped").enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Plex Wrapped (arranque)", () => require("../systems/plexWrapped").enviarSiToca(client));
    // 🎬 Sesiones de cine: el recordatorio de 10 minutos antes, cada 5 minutos.
    cron.schedule("*/5 * * * *", () => runJob("Recordatorios de cine", () => require("../systems/cine").enviarRecordatorios(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 🏅 Liga de pronósticos: cada hora y al arrancar; liquida la temporada anterior el 1 de julio desde las 10:00.
    cron.schedule("0 * * * *", () => runJob("Liga de pronósticos", () => require("../systems/apuestas/liga").liquidarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Liga de pronósticos (arranque)", () => require("../systems/apuestas/liga").liquidarSiToca(client));
    // 📊 Resumen semanal por DM a quien recibe las alertas: los lunes desde las 09:00 (igual: cada hora y al arrancar).
    cron.schedule("0 * * * 1", () => runJob("Resumen semanal para admins", () => require("../systems/resumenAdmin").enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Resumen semanal para admins (arranque)", () => require("../systems/resumenAdmin").enviarSiToca(client));
    // Mensajes espontáneos del Duende para animar un server parado: de 11:00 a 23:00, con una
    // probabilidad baja cada vez (DUENDE_ESPONTANEO_PROB) y solo si el canal lleva un rato sin
    // mensajes de verdad. Se puede desactivar o elegir el canal en Config Global → Duende.
    cron.schedule(
        "0 11-23 * * *",
        () => runJob("Mensajes espontáneos del Duende", () => require("../systems/duende/espontaneo").revisarTodos(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    // ⭐ Partido destacado del día en el canal de resultados: desde las 10:00 (cada hora por si el bot estaba caído; solo
    // una vez al día), y al arrancar por si no se ha publicado. Sin gastar créditos de la Odds API.
    cron.schedule(
        "0 10-20 * * *",
        () => runJob("Partido destacado del día", () => require("../systems/apuestas/destacado").publicarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Partido destacado del día (arranque)", () => require("../systems/apuestas/destacado").publicarSiToca(client));
    // Recordatorio por DM antes de los partidos a los que se ha apostado.
    cron.schedule(
        "*/5 * * * *",
        () => runJob("Recordatorio de partidos", () => require("../systems/apuestas/recordatorios").enviarRecordatorios(client)),
        { noOverlap: true },
    );
    // ⚔️ Retos colgados: sin aceptar a tiempo, duelos abandonados y porras sin resolver (se devuelven o se resuelven).
    cron.schedule("*/5 * * * *", () => runJob("Retos caducados", () => require("../juegos/retos/retos").revisarRetos(client)), {
        noOverlap: true,
    });
    // 🧙 Préstamos del Duende vencidos: se cobran solos (efectivo y luego banco) y se avisa por DM.
    cron.schedule("*/5 * * * *", () => runJob("Préstamos del Duende", () => require("../juegos/retos/duende").revisarPrestamos(client)), {
        noOverlap: true,
    });
    // 🏪 Negocios: blanquea el dinero negro depositado (24 h) y paga el ingreso diario de cada negocio.
    cron.schedule("*/5 * * * *", () => runJob("Negocios y blanqueo", () => require("../systems/negocios").revisar()), {
        noOverlap: true,
    });
    // 💹 Evento diario de TTCL (±5 %, a una hora aleatoria del día): aplica el del día y avisa por DM a quien lo tiene.
    cron.schedule("*/5 * * * *", () => runJob("Evento de TTCL", () => require("../systems/cripto/eventos").revisarYAvisar(client)), {
        noOverlap: true,
    });
    // 🏦 Patrimonio: cada persona tiene su ciclo semanal (interés del banco e impuesto sobre lo que pasa del umbral).
    cron.schedule("0 * * * *", () => runJob("Patrimonio", () => require("../systems/patrimonio").revisar()), {
        noOverlap: true,
    });
    // Liquidación automática de apuestas deportivas y quinielas (antes solo con /pagarapuestas).
    cron.schedule(
        "15 * * * *",
        () =>
            runJob(
                "Liquidación de apuestas",
                async () => {
                    const resumen = await pagarapuestas.liquidarApuestas({
                        minHorasDesdeInicio: pagarapuestas.AUTO_MIN_HORAS_DESDE_INICIO,
                        origen: "cron",
                    });
                    if (resumen) {
                        await pagarapuestas.avisarGanadores(client, resumen.pagos);
                        await pagarapuestas.anunciarResultados(client, resumen);
                        await require("../juegos/retos/retos").actualizarMensajes(client, resumen.retosCerrados);
                    }
                },
                { slowMs: 120_000 },
            ),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    // Copia de seguridad diaria de la BD (data/backups, se conservan las últimas 7).
    cron.schedule("30 4 * * *", () => runJob("Backup de la BD", () => require("../systems/backups").hacerBackup()), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // Partidas de casino abandonadas (>15 min sin tocar): se liquidan como perdidas.
    setInterval(
        () =>
            runJob("Partidas abandonadas", () => {
                blackjack.limpiarAbandonadas();
                adivinar.limpiarAbandonadas();
            }),
        5 * 60 * 1000,
    );
}

module.exports = { programarTareas };
