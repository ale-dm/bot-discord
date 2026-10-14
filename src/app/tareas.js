// ⏰ Tareas programadas del bot: avisos diarios y semanales, Plex, apuestas, cripto, negocios y copias de seguridad.
// Cada una va envuelta en runJob (registra errores y evita solapamientos). Se programan al arrancar (clientReady).
const cron = require("node-cron");
const { ActivityType } = require("discord.js");
const { createLogger } = require("../core/logger");
const alertas = require("../systems/alertas");
const xpSystem = require("../systems/xpSystem");
const tautulliClient = require("../services/tautulliClient");
const { runJob } = require("../core/interactionLog");
const pagarapuestas = require("../systems/apuestas/liquidacion");
const blackjack = require("../juegos/casino/blackjack.js");
const adivinar = require("../juegos/casino/adivinar.js");
const pptSerie = require("../systems/casino/pptSerie");

const pedidosSeerr = require("../systems/pedidosSeerr");
const plexAvisos = require("../systems/plexAvisos");
const plexHistorial = require("../systems/plexHistorial");
const plexRankingSemanal = require("../systems/plexRankingSemanal");
const clasificacionSemanal = require("../systems/clasificacionSemanal");
const resumenApuestas = require("../systems/apuestas/resumenSemanal");
const recordatorioLogros = require("../systems/logros/recordatorio");
const ordenesCripto = require("../systems/cripto/ordenes");
const mensajesOrdenes = require("../discord/mensajes/criptoOrdenes");
const { enviarAviso } = require("../systems/avisosDm");
const recordarPersonal = require("../systems/recordarPersonal");
const patrimonioDiario = require("../systems/patrimonioDiario");
const avisoDomingo = require("../systems/clasificacion/avisoDomingo");
const { embedDomingo } = require("../discord/mensajes/clasificacionDomingo");
const tienda = require("../systems/tienda");
const mercado = require("../systems/mercado");
const sueldos = require("../systems/sueldos");
const metaBote = require("../systems/impuestos/meta");
const paseHistorial = require("../systems/pase/historial");
const paseAvisos = require("../systems/pase/avisos");
const oddsApi = require("../services/oddsApi");
const plexWrapped = require("../systems/plexWrapped");
const cine = require("../systems/cine");
const cineSeries = require("../systems/cine/series");
const { pantallaSesion } = require("../paneles/cine");
const liga = require("../systems/apuestas/liga");
const resumenAdmin = require("../systems/resumenAdmin");
const espontaneo = require("../systems/duende/espontaneo");
const destacado = require("../systems/apuestas/destacado");
const recordatorios = require("../systems/apuestas/recordatorios");
const retos = require("../juegos/retos/retos");
const duende = require("../juegos/retos/duende");
const negocios = require("../systems/negocios");
const eventos = require("../systems/cripto/eventos");
const patrimonio = require("../systems/patrimonio");
const encuesta = require("../commands/general/encuesta");
const avisosCooldown = require("../systems/avisosCooldown");
const cumpleanos = require("../systems/cumpleanos");
const backups = require("../systems/backups");

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

// Cada grupo registra sus tareas en el mismo orden que antes: algunas se lanzan al arrancar (los "(arranque)"), y ese
// orden decide qué se publica primero.

function programarBasicas(client) {
    runJob("Alertas pendientes del arranque", () => alertas.iniciar(client));
    actualizarActividad(client);
    setInterval(() => actualizarActividad(client), 5400000);
    setInterval(() => runJob("XP de voz", () => xpSystem.voiceTick(client)), 60000);
    cron.schedule("0 17 * * *", () => runJob("Aviso de rachas", () => xpSystem.runStreakWarningJob(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 💔 Al empezar el día, a quien acaba de perder una racha larga (#342); de paso borra la XP diaria vieja.
    cron.schedule("30 0 * * *", () => runJob("Aviso de racha perdida", () => xpSystem.runStreakLostJob(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 🏅 Los domingos por la tarde, a quien tiene logros sin reclamar (#378).
    cron.schedule(
        "0 18 * * 0",
        () => runJob("Recordatorio de logros sin reclamar", () => recordatorioLogros.runLogrosPendientesJob(client)),
        {
            timezone: "Europe/Madrid",
            noOverlap: true,
        },
    );
}

function programarNovedadesPlex(client) {
    // Novedades de Plex y, después (para que el "Nuevo en Plex" salga antes), el aviso a quien lo pidió en Seerr. Al
    // final, el historial de Plex para los logros (la primera vez importa el historial entero: puede tardar).
    cron.schedule(
        "*/30 * * * *",
        async () => {
            await runJob("Novedades de Plex", () => tautulliClient.checkAllGuildsForNewContent(client));
            await runJob("Avisos de pedidos de Seerr", () => pedidosSeerr.avisarDisponibles(client));
            await runJob("Avisos de pedidos rechazados de Seerr", () => pedidosSeerr.avisarRechazados(client));
            await runJob("Avisos de series seguidas", () => plexAvisos.avisarSeries(client));
            await runJob("Avisos de quiero ver", () => plexAvisos.avisarQuieroVer(client));
            await runJob("Historial y logros de Plex", () => plexHistorial.sincronizarTodos(client), {
                slowMs: 120_000,
            });
        },
        { noOverlap: true },
    );
    // 🍿 Ranking semanal de Plex: los lunes desde las 10:00 (cada hora por si el bot estaba caído; solo una vez por
    // semana), y al arrancar por si es lunes y no se ha publicado.
    cron.schedule("0 * * * 1", () => runJob("Ranking semanal de Plex", () => plexRankingSemanal.enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Ranking semanal de Plex (arranque)", () => plexRankingSemanal.enviarSiToca(client));
}

function programarClasificacionSemanal(client) {
    // 🏆 Clasificación semanal con premios (el más rico, el más activo y el mejor apostador): igual, los lunes desde las 10:00.
    cron.schedule("0 * * * 1", () => runJob("Clasificación semanal", () => clasificacionSemanal.publicarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Clasificación semanal (arranque)", () => clasificacionSemanal.publicarSiToca(client));
    // 📊 Resumen semanal de apuestas por DM (#361): los lunes desde las 10:00, a quien tuvo apuestas resueltas la semana anterior.
    cron.schedule("0 * * * 1", () => runJob("Resumen semanal de apuestas", () => resumenApuestas.enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Resumen semanal de apuestas (arranque)", () => resumenApuestas.enviarSiToca(client));
}

function programarPase(client) {
    // 🛡️ Pase de batalla: cada hora, guarda el resumen de las temporadas ya cerradas (#300) y, en el último día de la temporada, avisa por DM
    // de los niveles sin cobrar (#348). Los dos van una sola vez.
    const tarea = () => {
        paseHistorial.cerrarPasadas();
        return paseAvisos.avisarSinCobrar(client);
    };
    cron.schedule("30 * * * *", () => runJob("Pase de batalla", tarea), { timezone: "Europe/Madrid", noOverlap: true });
    runJob("Pase de batalla (arranque)", tarea);
}

function programarCuotasEnDirecto(client) {
    // 🔴 Apuestas en directo (#12): refresca cada 10 minutos las cuotas de las competiciones con partidos en juego.
    // Solo con ODDS_DIRECTO=1 (cada refresco gasta créditos de la Odds API).
    cron.schedule("*/10 * * * *", () => runJob("Cuotas en directo", () => oddsApi.refrescarEnDirecto()), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
}

/** Cada 5 minutos: las sesiones semanales que toca crear (#403) y el recordatorio de las que empiezan en 10 minutos. */
async function cineRecordatorios(client) {
    await cineSeries.crearSiguientes(client, cine, pantallaSesion);
    return cine.enviarRecordatorios(client);
}

function programarWrapped(client) {
    // 🎞️ Plex Wrapped: el día 1 de cada mes, desde las 10:00 (Madrid), el resumen del mes anterior (cada hora, y al arrancar).
    cron.schedule("0 * * * *", () => runJob("Plex Wrapped", () => plexWrapped.enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Plex Wrapped (arranque)", () => plexWrapped.enviarSiToca(client));
}

function programarCine(client) {
    // 🎬 Sesiones de cine: el recordatorio de 10 minutos antes, cada 5 minutos.
    cron.schedule("*/5 * * * *", () => runJob("Recordatorios de cine", () => cineRecordatorios(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
}

function programarLigaPronosticos(client) {
    // 🏅 Liga de pronósticos: cada hora y al arrancar; liquida la temporada anterior el 1 de julio desde las 10:00.
    cron.schedule("0 * * * *", () => runJob("Liga de pronósticos", () => liga.liquidarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Liga de pronósticos (arranque)", () => liga.liquidarSiToca(client));
}

function programarResumenAdmin(client) {
    // 📊 Resumen semanal por DM a quien recibe las alertas: los lunes desde las 09:00 (igual: cada hora y al arrancar).
    cron.schedule("0 * * * 1", () => runJob("Resumen semanal para admins", () => resumenAdmin.enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Resumen semanal para admins (arranque)", () => resumenAdmin.enviarSiToca(client));
}

function programarEspontaneos(client) {
    // Mensajes espontáneos del Duende para animar un server parado: de 11:00 a 23:00, con una
    // probabilidad baja cada vez (DUENDE_ESPONTANEO_PROB) y solo si el canal lleva un rato sin
    // mensajes de verdad. Se puede desactivar o elegir el canal en Config Global → Duende.
    cron.schedule("0 11-23 * * *", () => runJob("Mensajes espontáneos del Duende", () => espontaneo.revisarTodos(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
}

function programarApuestas(client) {
    // ⭐ Partido destacado del día en el canal de resultados: desde las 10:00 (cada hora por si el bot estaba caído; solo
    // una vez al día), y al arrancar por si no se ha publicado. Sin gastar créditos de la Odds API.
    cron.schedule("0 10-20 * * *", () => runJob("Partido destacado del día", () => destacado.publicarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Partido destacado del día (arranque)", () => destacado.publicarSiToca(client));
    // Recordatorio por DM antes de los partidos a los que se ha apostado.
    cron.schedule("*/5 * * * *", () => runJob("Recordatorio de partidos", () => recordatorios.enviarRecordatorios(client)), {
        noOverlap: true,
    });
}

async function economiaComunitaria(client) {
    for (const guild of client.guilds.cache.values()) {
        sueldos.pagarDia(guild.id, guild.members.cache.values());
        metaBote.comprobar(guild.id, (userId) => guild.members.cache.has(userId));
    }
}

function programarOrdenesCripto(client) {
    // 🔔 Cada minuto: alertas de precio, stop-loss y compras recurrentes de TTCL (#298, #341, #351).
    cron.schedule(
        "* * * * *",
        () =>
            runJob("Órdenes de TTCL", () =>
                ordenesCripto.revisar((userId, payload) => enviarAviso(client, userId, "cripto_ordenes", payload), mensajesOrdenes),
            ),
        { noOverlap: true },
    );
}

function programarRetosYEconomia(client) {
    // ⚔️ Retos colgados: sin aceptar a tiempo, duelos abandonados y porras sin resolver (se devuelven o se resuelven).
    cron.schedule("*/5 * * * *", () => runJob("Retos caducados", () => retos.revisarRetos(client)), {
        noOverlap: true,
    });
    // 🧙 Préstamos del Duende vencidos: se cobran solos (efectivo y luego banco) y se avisa por DM.
    cron.schedule("*/5 * * * *", () => runJob("Préstamos del Duende", () => duende.revisarPrestamos(client)), {
        noOverlap: true,
    });
    // 🏪 Negocios: blanquea el dinero negro depositado (24 h) y paga el ingreso diario de cada negocio.
    cron.schedule("*/5 * * * *", () => runJob("Negocios y blanqueo", () => negocios.revisar()), {
        noOverlap: true,
    });
    // 💹 Evento diario de TTCL (±5 %, a una hora aleatoria del día): aplica el del día y avisa por DM a quien lo tiene.
    cron.schedule("*/5 * * * *", () => runJob("Evento de TTCL", () => eventos.revisarYAvisar(client)), {
        noOverlap: true,
    });
    // 🛒 Cada hora: los precios que subieron por la demanda bajan hacia su base (#412) y las ofertas del mercado caducadas
    // vuelven a su dueño (#374).
    cron.schedule(
        "10 * * * *",
        () =>
            runJob("Mantenimiento de la tienda", () => {
                tienda.recuperarPrecios([...client.guilds.cache.keys()]);
                mercado.devolverCaducadas();
            }),
        { noOverlap: true },
    );
    // 💼 Cada hora: el sueldo diario por rol (una vez por día y persona, con registro en la base de datos, #416) y la meta
    // comunitaria del bote (#415).
    cron.schedule("20 * * * *", () => runJob("Sueldos y meta del bote", () => economiaComunitaria(client)), { noOverlap: true });
    // 📈 Al empezar el día, el efectivo + banco de cada persona para la gráfica de 💰 Economía (#388); al arrancar guarda el de hoy
    // si el bot estaba apagado a esa hora.
    runJob("Patrimonio diario (arranque)", () => patrimonioDiario.guardarHoy());
    cron.schedule("5 0 * * *", () => runJob("Patrimonio diario", () => patrimonioDiario.guardarHoy()), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 🏆 El domingo a las 20:00, a quien lo haya pedido y vaya primero en la clasificación de la semana (#394).
    cron.schedule(
        "0 20 * * 0",
        () => runJob("Aviso del domingo de la clasificación", () => avisoDomingo.avisarLideres(client, embedDomingo)),
        {
            timezone: "Europe/Madrid",
            noOverlap: true,
        },
    );
    // 🏦 Patrimonio: cada persona tiene su ciclo semanal (interés del banco e impuesto sobre lo que pasa del umbral).
    cron.schedule("0 * * * *", () => runJob("Patrimonio", () => patrimonio.revisar()), {
        noOverlap: true,
    });
}

function programarComunidad(client) {
    // ⏰ Recordatorios personales (/recordar): cada minuto manda por DM los que ya tocan (#320).
    cron.schedule("* * * * *", () => runJob("Recordatorios personales", () => recordarPersonal.enviarVencidos(client)), {
        noOverlap: true,
    });
    // 📊 Encuestas: cada minuto cierra las que han acabado su tiempo y repinta su mensaje con el resultado final.
    cron.schedule("* * * * *", () => runJob("Encuestas vencidas", () => encuesta.cerrarVencidas(client)), {
        noOverlap: true,
    });
    // 🔔 Avisos de cooldown (/trabajar y /robar): cada minuto manda los que han vencido, y al arrancar los que vencieron con el bot caído.
    cron.schedule("* * * * *", () => runJob("Avisos de cooldown", () => avisosCooldown.enviarVencidos(client)), {
        noOverlap: true,
    });
    runJob("Avisos de cooldown (arranque)", () => avisosCooldown.enviarVencidos(client));
    // 🎂 Cumpleaños: desde las 09:00 (Madrid) felicita a quien cumple hoy (cada hora por si el bot estaba caído; una sola vez al año
    // por persona), y al arrancar por si no se ha publicado.
    cron.schedule("0 * * * *", () => runJob("Felicitaciones de cumpleaños", () => cumpleanos.felicitarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Felicitaciones de cumpleaños (arranque)", () => cumpleanos.felicitarSiToca(client));
}

function programarLiquidacionApuestas(client) {
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
                        await retos.actualizarMensajes(client, resumen.retosCerrados);
                    }
                },
                { slowMs: 120_000 },
            ),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
}

function programarMantenimiento() {
    // Copia de seguridad diaria de la BD (data/backups, se conservan las últimas 7).
    cron.schedule("30 4 * * *", () => runJob("Backup de la BD", () => backups.hacerBackup()), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // Partidas de casino abandonadas (>15 min sin tocar): se liquidan como perdidas.
    setInterval(
        () =>
            runJob("Partidas abandonadas", () => {
                blackjack.limpiarAbandonadas();
                adivinar.limpiarAbandonadas();
                pptSerie.limpiarAbandonadas();
            }),
        5 * 60 * 1000,
    );
}

function programarTareas(client) {
    programarBasicas(client);
    programarNovedadesPlex(client);
    programarClasificacionSemanal(client);
    programarCuotasEnDirecto(client);
    programarWrapped(client);
    programarCine(client);
    programarLigaPronosticos(client);
    programarResumenAdmin(client);
    programarEspontaneos(client);
    programarApuestas(client);
    programarPase(client);
    programarOrdenesCripto(client);
    programarRetosYEconomia(client);
    programarComunidad(client);
    programarLiquidacionApuestas(client);
    programarMantenimiento();
}

module.exports = { programarTareas };
