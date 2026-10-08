// Importar discord.js
const { Client, GatewayIntentBits, ActivityType, Collection, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
require("dotenv").config();
const { createLogger, logErrorSync, flushLogs, registerSecret } = require("./core/logger");
const { whoWhere, describeCommand, componentKind, describeComponentInput, runJob, cut } = require("./core/interactionLog");

// Cada error registrado desde aquí puede acabar en una alerta por DM a los admins (se envían al conectar).
const alertas = require("./systems/alertas");
alertas.escucharErrores();

const log = createLogger("Bot");
const cmdLog = createLogger("Comando");
const compLog = createLogger("Componente");
const msgLog = createLogger("Mensajes");
const gwLog = createLogger("Discord");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Los logros que se calculan sin el servidor a mano (casino, cripto) lo buscan aquí para anunciarse.
require("./systems/achievementsSystem").setClient(client);

const Estado = process.env.ESTADOS ? process.env.ESTADOS.split(",") : ["Jugando"];
const duendeCommand = require("./commands/duende/duende");
const adivinar = require("./juegos/casino/adivinar.js");
const blackjack = require("./juegos/casino/blackjack.js");
const pagarapuestas = require("./systems/apuestas/liquidacion");
const cripto = require("./systems/cripto/mercado");
const xpSystem = require("./systems/xpSystem");
const tautulliClient = require("./services/tautulliClient");
const guildSettings = require("./systems/guildSettings");
const activeGames = require("./systems/activeGames");
const { createComponentRouter } = require("./core/componentRouter");
const DUENDE_TEXT_REPLY_PROB = Math.max(0, Math.min(1, Number(process.env.DUENDE_TEXT_REPLY_PROB || 0.25)));
// Ventana de conversación activa: tras hablarle (o que él hable), sube la probabilidad
// de respuesta para que un intercambio no se corte solo por mala suerte del dado.
const DUENDE_ACTIVE_TEXT_REPLY_PROB = Math.max(0, Math.min(1, Number(process.env.DUENDE_ACTIVE_TEXT_REPLY_PROB ?? 1)));
const DUENDE_ACTIVE_WINDOW_MS = Number(process.env.DUENDE_ACTIVE_WINDOW_MS || 3 * 60 * 1000);
const duendeActiveChannels = new Map(); // channelId -> timestamp del último "enganche"

// Guardarraíl: si Discord (gateway resume, reconexión...) entrega el mismo mensaje dos veces,
// procesarlo dos veces podría disparar dos veces una acción real (ej. dos peticiones de Seerr
// para el mismo mensaje). El id de mensaje de Discord es único e inmutable, así que basta con
// no volver a procesar uno ya visto recientemente.
const recentlyProcessedMessageIds = new Map(); // messageId -> timestamp
const MESSAGE_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
function isDuplicateMessage(messageId) {
    const now = Date.now();
    if (recentlyProcessedMessageIds.size > 500) {
        const cutoff = now - MESSAGE_DEDUPE_WINDOW_MS;
        for (const [id, ts] of recentlyProcessedMessageIds) {
            if (ts < cutoff) recentlyProcessedMessageIds.delete(id);
        }
    }
    if (recentlyProcessedMessageIds.has(messageId)) return true;
    recentlyProcessedMessageIds.set(messageId, now);
    return false;
}

// Mensajes de bajo esfuerzo (risas, "xd", un emoji suelto): en vez de gastar una llamada
// a la IA para generar una respuesta completa, el Duende solo reacciona — más barato y
// más parecido a cómo reacciona alguien real a ese tipo de mensajes.
const LOW_EFFORT_REACTIONS = ["😂", "🤣", "👀", "💀", "😏", "🔥"];
function isLowEffortMessage(text) {
    const t = text.trim();
    if (!t) return false;
    if (/^(ja|je|ji|jo|ju|aj|js){2,}!*$/i.test(t)) return true; // jajaja, jeje, jsjsjs, ajaj...
    if (/^(lo+l+|lmao+|xd+)!*$/i.test(t)) return true;
    // Muy corto y sin ninguna letra (solo emoji/puntuación/signos)
    if (t.length <= 6 && !/[a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ]/.test(t)) return true;
    return false;
}
const db = require("./core/db");
const { ROOT, COMMANDS_DIR, JUEGOS_DIR, PERFIL_DIR } = require("./core/paths");

// src/commands solo contiene slash commands (un fichero por comando, en subcarpetas por tema).
function getAllJsFiles(dir) {
    let results = [];
    fs.readdirSync(dir).forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllJsFiles(filePath));
        } else if (file.endsWith(".js")) {
            results.push(filePath);
        }
    });
    return results;
}

// Cargar slash commands y los componentes (botones, selects, modales) que declara cada módulo
client.slashCommands = new Collection();
const componentRouter = createComponentRouter();
try {
    const slashCommandsFiles = getAllJsFiles(COMMANDS_DIR);
    for (const file of slashCommandsFiles) {
        // Evita cargar archivos que no exportan un comando válido
        try {
            const slash = require(file);
            if (slash && slash.data && slash.data.name) {
                client.slashCommands.set(slash.data.name, slash);
            }
            componentRouter.register(slash, path.relative(ROOT, file));
        } catch (e) {
            log.error(`No se pudo cargar el módulo ${path.relative(ROOT, file)}:`, e);
        }
    }
    // Los juegos, las apuestas y el dinero no son comandos (se entra por /juegos y /perfil), pero sus
    // botones sí se atienden.
    for (const file of [...getAllJsFiles(JUEGOS_DIR), ...getAllJsFiles(PERFIL_DIR)]) {
        try {
            componentRouter.register(require(file), path.relative(ROOT, file));
        } catch (e) {
            log.error(`No se pudo cargar el módulo ${path.relative(ROOT, file)}:`, e);
        }
    }
    log.info(`Cargados ${client.slashCommands.size} comandos y ${componentRouter.size} rutas de componentes.`);
} catch (err) {
    log.error("Error cargando los comandos:", err);
}

// Claves guardadas desde el panel (Plex/Seerr): también se ocultan en los logs.
try {
    for (const row of db.prepare("SELECT value FROM guild_settings WHERE key IN ('plex.tautulli_api_key', 'seerr.api_key')").all()) {
        registerSecret(row.value);
    }
} catch (e) {
    log.debug("No se pudieron cargar las claves del panel para ocultarlas en los logs:", e.message);
}

// Apodos del Duende pendientes de importar (data/duende-apodos.seed.json), si los hay.
require("./systems/apodos").importarFicheroSiExiste();
// Personalidades y perfiles del Duende de los JSON antiguos (data/duende-personalities.json,
// data/duende-config.json), si quedan por importar a la BD.
require("./systems/duende/perfiles").importarJsonSiExiste();

// El estado de las partidas de casino vive en memoria: lo que quedara apostado en
// partidas a medias antes de este arranque se devuelve antes de aceptar interacciones.
const reembolsadas = activeGames.reembolsarPendientes();
if (reembolsadas > 0) log.info(`${reembolsadas} partidas de casino interrumpidas por el reinicio reembolsadas.`);

// Evento cuando el bot está listo
// "clientReady" (antes "ready", que discord.js 14 marca como obsoleto y quita en la 15).
client.once("clientReady", async () => {
    const guilds = [...client.guilds.cache.values()].map((g) => `${g.name} (${g.id})`).join(", ");
    log.info(`Conectado como ${client.user.tag} · ${client.guilds.cache.size} servidor(es): ${guilds}`);
    // Única línea de consola al arrancar; el detalle va a logs/app-log.txt.
    const n = client.guilds.cache.size;
    console.log(`✓ Conectado como ${client.user.tag} · ${n} servidor${n === 1 ? "" : "es"} · ${client.slashCommands.size} comandos`);
    runJob("Alertas pendientes del arranque", () => alertas.iniciar(client));
    actualizarActividad();
    setInterval(actualizarActividad, 5400000);
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
            await runJob("Avisos de pedidos de Seerr", () => require("./systems/pedidosSeerr").avisarDisponibles(client));
            await runJob("Historial y logros de Plex", () => require("./systems/plexHistorial").sincronizarTodos(client), {
                slowMs: 120_000,
            });
        },
        { noOverlap: true },
    );
    // 🍿 Ranking semanal de Plex: los lunes desde las 10:00 (cada hora por si el bot estaba caído; solo una vez por
    // semana), y al arrancar por si es lunes y no se ha publicado.
    cron.schedule(
        "0 * * * 1",
        () => runJob("Ranking semanal de Plex", () => require("./systems/plexRankingSemanal").enviarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Ranking semanal de Plex (arranque)", () => require("./systems/plexRankingSemanal").enviarSiToca(client));
    // 🏆 Clasificación semanal con premios (el más rico, el más activo y el mejor apostador): igual, los lunes desde las 10:00.
    cron.schedule(
        "0 * * * 1",
        () => runJob("Clasificación semanal", () => require("./systems/clasificacionSemanal").publicarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Clasificación semanal (arranque)", () => require("./systems/clasificacionSemanal").publicarSiToca(client));
    // 🎞️ Plex Wrapped: el día 1 de cada mes, desde las 10:00 (Madrid), el resumen del mes anterior (cada hora, y al arrancar).
    cron.schedule("0 * * * *", () => runJob("Plex Wrapped", () => require("./systems/plexWrapped").enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Plex Wrapped (arranque)", () => require("./systems/plexWrapped").enviarSiToca(client));
    // 🎬 Sesiones de cine: el recordatorio de 10 minutos antes, cada 5 minutos.
    cron.schedule("*/5 * * * *", () => runJob("Recordatorios de cine", () => require("./systems/cine").enviarRecordatorios(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    // 🏅 Liga de pronósticos: cada hora y al arrancar; liquida la temporada anterior el 1 de julio desde las 10:00.
    cron.schedule("0 * * * *", () => runJob("Liga de pronósticos", () => require("./systems/apuestas/liga").liquidarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Liga de pronósticos (arranque)", () => require("./systems/apuestas/liga").liquidarSiToca(client));
    // 📊 Resumen semanal por DM a quien recibe las alertas: los lunes desde las 09:00 (igual: cada hora y al arrancar).
    cron.schedule("0 * * * 1", () => runJob("Resumen semanal para admins", () => require("./systems/resumenAdmin").enviarSiToca(client)), {
        timezone: "Europe/Madrid",
        noOverlap: true,
    });
    runJob("Resumen semanal para admins (arranque)", () => require("./systems/resumenAdmin").enviarSiToca(client));
    // Mensajes espontáneos del Duende para animar un server parado: de 11:00 a 23:00, con una
    // probabilidad baja cada vez (DUENDE_ESPONTANEO_PROB) y solo si el canal lleva un rato sin
    // mensajes de verdad. Se puede desactivar o elegir el canal en Config Global → Duende.
    cron.schedule(
        "0 11-23 * * *",
        () => runJob("Mensajes espontáneos del Duende", () => require("./systems/duende/espontaneo").revisarTodos(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    // ⭐ Partido destacado del día en el canal de resultados: desde las 10:00 (cada hora por si el bot estaba caído; solo
    // una vez al día), y al arrancar por si no se ha publicado. Sin gastar créditos de la Odds API.
    cron.schedule(
        "0 10-20 * * *",
        () => runJob("Partido destacado del día", () => require("./systems/apuestas/destacado").publicarSiToca(client)),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    runJob("Partido destacado del día (arranque)", () => require("./systems/apuestas/destacado").publicarSiToca(client));
    // Recordatorio por DM antes de los partidos a los que se ha apostado.
    cron.schedule(
        "*/5 * * * *",
        () => runJob("Recordatorio de partidos", () => require("./systems/apuestas/recordatorios").enviarRecordatorios(client)),
        { noOverlap: true },
    );
    // ⚔️ Retos colgados: sin aceptar a tiempo, duelos abandonados y porras sin resolver (se devuelven o se resuelven).
    cron.schedule("*/5 * * * *", () => runJob("Retos caducados", () => require("./juegos/retos/retos").revisarRetos(client)), {
        noOverlap: true,
    });
    // 🧙 Préstamos del Duende vencidos: se cobran solos (efectivo y luego banco) y se avisa por DM.
    cron.schedule("*/5 * * * *", () => runJob("Préstamos del Duende", () => require("./juegos/retos/duende").revisarPrestamos(client)), {
        noOverlap: true,
    });
    // 🏪 Negocios: blanquea el dinero negro depositado (24 h) y paga el ingreso diario de cada negocio.
    cron.schedule("*/5 * * * *", () => runJob("Negocios y blanqueo", () => require("./systems/negocios").revisar()), {
        noOverlap: true,
    });
    // 💹 Evento diario de TTCL (±5 %, a una hora aleatoria del día): aplica el del día y avisa por DM a quien lo tiene.
    cron.schedule("*/5 * * * *", () => runJob("Evento de TTCL", () => require("./systems/cripto/eventos").revisarYAvisar(client)), {
        noOverlap: true,
    });
    // 🏦 Patrimonio: cada persona tiene su ciclo semanal (interés del banco e impuesto sobre lo que pasa del umbral).
    cron.schedule("0 * * * *", () => runJob("Patrimonio", () => require("./systems/patrimonio").revisar()), {
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
                        await require("./juegos/retos/retos").actualizarMensajes(client, resumen.retosCerrados);
                    }
                },
                { slowMs: 120_000 },
            ),
        { timezone: "Europe/Madrid", noOverlap: true },
    );
    // Copia de seguridad diaria de la BD (data/backups, se conservan las últimas 7).
    cron.schedule("30 4 * * *", () => runJob("Backup de la BD", () => require("./systems/backups").hacerBackup()), {
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
    // ¿El modelo de Gemini de cada servidor existe y usa herramientas? Mejor saberlo al arrancar que por un dato
    // inventado en el chat (una llamada a Gemini por modelo distinto). Si no existe o no usa herramientas, se cambia
    // solo por uno que funcione (GEMINI_FALLBACK_MODELS) y se avisa a los admins.
    runJob("Comprobación del modelo de Gemini", async () => {
        if (!process.env.GOOGLE_API_KEY) return;
        await require("./systems/duende/modeloGemini").comprobarAlArrancar([...client.guilds.cache.keys()]);
    });
    // Backfill roles para usuarios que subieron nivel antes de tener las recompensas configuradas
    for (const guild of client.guilds.cache.values()) {
        runJob(
            `Backfill de roles (${guild.name})`,
            async () => {
                const n = await xpSystem.backfillRoles(guild);
                if (n > 0) log.info(`Backfill: ${n} roles de nivel asignados en ${guild.name}`);
                // Después del backfill, que ya ha cargado los miembros del servidor: pedirlos otra vez
                // a la vez hacía que Discord limitara la petición ("opcode 8 was rate limited").
                await require("./systems/duende/perfiles").vincularPerfiles(guild);
            },
            { slowMs: 120_000 },
        );
    }
    setInterval(
        () =>
            runJob("Ticker TTCL", () => {
                // Con el servidor: sin él se usaba el precio base por defecto e ignoraba el configurado
                // en el panel, y la gráfica saltaba entre los dos precios cada 10 minutos.
                const currentPrice = cripto.getTtclPrecio();
                db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(currentPrice, Date.now());
                createLogger("Cripto").debug(`Ticker TTCL: precio registrado ${Number(currentPrice).toFixed(2)}`);
            }),
        10 * 60 * 1000,
    );
});

// Función para actualizar la actividad del bot
function actualizarActividad() {
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

// Estado de la conexión con Discord. Sin esto, una caída/reconexión del gateway o un
// rate limit no dejaban ningún rastro en los logs.
client.on("error", (e) => gwLog.error("Error del cliente de Discord:", e));
client.on("warn", (m) => gwLog.warn(m));
// Al apagar (Ctrl+C, docker stop) el propio bot cierra la conexión con código 1000: no es un aviso.
client.on("shardDisconnect", (ev, id) => {
    const code = ev?.code ?? "?";
    if (shuttingDown || code === 1000) gwLog.debug(`Shard ${id} desconectado (código ${code}, cierre normal)`);
    else gwLog.warn(`Shard ${id} desconectado inesperadamente (código ${code})`);
});
client.on("shardReconnecting", (id) => gwLog.info(`Shard ${id} reconectando...`));
client.on("shardResume", (id, replayed) => gwLog.info(`Shard ${id} reanudado (${replayed} eventos repetidos)`));
client.on("shardError", (e, id) => gwLog.error(`Error en el shard ${id}:`, e));
client.on("invalidated", () => gwLog.error("Sesión de Discord invalidada"));
client.on("guildCreate", (g) => gwLog.info(`Añadido a un servidor: ${g.name} (${g.id})`));
client.on("guildDelete", (g) => gwLog.warn(`Expulsado o eliminado de un servidor: ${g.name ?? "?"} (${g.id})`));
client.rest.on("rateLimited", (info) =>
    gwLog.warn(
        `Rate limit de la API de Discord: ${info.method} ${info.route} · espera ${info.timeToReset} ms${info.global ? " (GLOBAL)" : ""}`,
    ),
);

// Responde sin romper si la interacción ya caducó o ya se respondió; lo registra en debug.
async function replySafe(interaction, payload) {
    try {
        if (!interaction.isRepliable()) return;
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
    } catch (e) {
        log.debug(`No se pudo responder a la interacción ${interaction.id}: ${e.message}`);
    }
}

// Manejo de interacciones (slash commands)
client.on("interactionCreate", async (interaction) => {
    const denyByAcl = async (commandName, logger, what) => {
        const acl = guildSettings.isCommandAllowed(interaction, commandName);
        if (acl.ok) return false;
        logger.info(`${what} denegado por ACL de /${commandName} · ${whoWhere(interaction)} · ${acl.message || ""}`);
        await replySafe(interaction, { content: acl.message || "⛔ Acción no permitida aquí.", flags: MessageFlags.Ephemeral });
        return true;
    };

    // ─── Botones, selects y formularios ───────────────────────────────────
    const route = componentRouter.match(interaction);
    if (route) {
        const what = `${componentKind(interaction)} ${interaction.customId}`;
        if (route.acl && (await denyByAcl(route.acl, compLog, what))) return;
        const t0 = Date.now();
        try {
            await route.mod[route.method](client, interaction);
            compLog.info(`${what}${describeComponentInput(interaction)} · ${whoWhere(interaction)} · ${Date.now() - t0} ms`);
        } catch (e) {
            compLog.error(`${what} falló (${route.source}.${route.method}) · ${whoWhere(interaction)} · ${Date.now() - t0} ms`, e);
            await replySafe(interaction, { content: "Hubo un error al procesar esta acción.", flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) {
        if (interaction.customId)
            compLog.warn(`Sin ruta para ${componentKind(interaction)} ${interaction.customId} · ${whoWhere(interaction)}`);
        return;
    }

    // ─── Slash commands ───────────────────────────────────────────────────
    const commandText = describeCommand(interaction);
    if (await denyByAcl(interaction.commandName, cmdLog, commandText)) return;
    const slashCommand = client.slashCommands.get(interaction.commandName);
    if (!slashCommand) {
        cmdLog.warn(`Comando desconocido ${commandText} (¿registrado en Discord pero sin módulo?) · ${whoWhere(interaction)}`);
        return;
    }

    const t0 = Date.now();
    try {
        await slashCommand.run(client, interaction);
        const ms = Date.now() - t0;
        cmdLog.info(`${commandText} · ${whoWhere(interaction)} · ${ms} ms`);
        // Discord da 3 s para el primer acuse: si no se respondió ni se difirió, el usuario vio "la aplicación no respondió".
        if (!interaction.deferred && !interaction.replied) {
            cmdLog.warn(`${commandText} terminó sin responder ni diferir la interacción · ${whoWhere(interaction)}`);
        }
    } catch (e) {
        cmdLog.error(`${commandText} falló · ${whoWhere(interaction)} · ${Date.now() - t0} ms`, e);
        await replySafe(interaction, { content: "Hubo un error al ejecutar el comando.", flags: MessageFlags.Ephemeral });
    }
});

// Manejo de mensajes de texto
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (isDuplicateMessage(message.id)) {
        msgLog.info(`Mensaje duplicado ignorado (id ${message.id}) de ${message.author.tag}`);
        return;
    }

    try {
        await xpSystem.handleMessageXp(message);
    } catch (e) {
        msgLog.error(`Error dando XP por mensaje · ${whoWhere(message)}`, e);
    }

    // 🧠 Recuerdos automáticos del Duende (#15): mira la conversación en segundo plano; no bloquea nada.
    try {
        require("./systems/duende/recuerdosAuto").observar(message);
    } catch (e) {
        msgLog.error(`Error mirando la conversación para los recuerdos del Duende · ${whoWhere(message)}`, e);
    }

    const userText = message.content.trim();
    const imageAttachmentsRaw = message.attachments
        ? [...message.attachments.values()].filter((a) => (a.contentType || "").startsWith("image/"))
        : [];

    // Evitar procesar mensajes que sean comandos (slash o que empiecen por /).
    // Un mensaje vacío solo se descarta si tampoco trae una imagen adjunta.
    if (userText.startsWith("/")) return;
    if (!userText && imageAttachmentsRaw.length === 0) return;

    // Si el mensaje no es de bot, llama al slashcommand duende.js directamente
    try {
        if (message.guildId) {
            const duendeCfg = guildSettings.getSettings(message.guildId).duende;
            if (duendeCfg.allowed_channel_id && message.channelId !== duendeCfg.allowed_channel_id) return;
        }
        // Cuenta como "le hablan directamente" tanto la mención real de Discord como
        // decir su nombre en texto plano ("duende, ¿qué opinas?"), sin necesidad del @.
        const isMentioned = !!client.user && message.mentions?.has?.(client.user.id);
        const mentionsNameInText = /\bduende\b/i.test(userText);
        const isAddressed = isMentioned || mentionsNameInText;

        const now = Date.now();
        const lastActiveAt = duendeActiveChannels.get(message.channelId) || 0;
        const withinActiveWindow = now - lastActiveAt < DUENDE_ACTIVE_WINDOW_MS;
        const effectiveProb = withinActiveWindow ? DUENDE_ACTIVE_TEXT_REPLY_PROB : DUENDE_TEXT_REPLY_PROB;

        if (!isAddressed && Math.random() > effectiveProb) {
            msgLog.debug(
                `Duende no responde por probabilidad (${Math.round(effectiveProb * 100)}%${withinActiveWindow ? ", ventana activa" : ""}) · ${message.author.tag}`,
            );
            return;
        }
        // Seguimos "enganchados" a esta charla: refresca la ventana de conversación activa.
        duendeActiveChannels.set(message.channelId, now);

        if (isLowEffortMessage(userText)) {
            try {
                const emoji = LOW_EFFORT_REACTIONS[Math.floor(Math.random() * LOW_EFFORT_REACTIONS.length)];
                await message.react(emoji);
                msgLog.debug(`Mensaje de bajo esfuerzo: solo reacción ${emoji} · ${message.author.tag}`);
            } catch (e) {
                msgLog.warn(`No se pudo reaccionar al mensaje de bajo esfuerzo · ${whoWhere(message)}: ${e.message}`);
            }
            return;
        }

        // Si el mensaje trae imágenes (meme, captura...), las descarga para que el
        // Duende también "las vea" al generar la respuesta, no solo lea el texto.
        const imageAttachments = [];
        for (const att of imageAttachmentsRaw.slice(0, 2)) {
            try {
                const res = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
                if (!res.ok) {
                    msgLog.warn(`No se pudo descargar imagen adjunta para Duende: HTTP ${res.status}`);
                    continue;
                }
                const buffer = Buffer.from(await res.arrayBuffer());
                imageAttachments.push({ buffer, mime: (att.contentType || "image/png").split(";")[0].trim() });
            } catch (e) {
                msgLog.warn(`No se pudo descargar imagen adjunta para Duende: ${e.message}`);
            }
        }
        const effectiveText = userText || (imageAttachments.length ? "(el usuario ha compartido una imagen sin texto)" : "");

        // Sin await a propósito (no hace falta esperar al "escribiendo..."), pero con catch:
        // si falta el permiso, antes acababa como unhandledRejection.
        message.channel.sendTyping().catch((e) => msgLog.warn(`sendTyping falló en ${message.channelId}: ${e.message}`));
        // Detectar si el mensaje es en un canal de texto de servidor
        const isGuild = !!message.guild && !!message.member && !!message.guild.id;
        let didSendReply = false;
        const fakeInteraction = {
            id: message.id,
            deferReply: async () => {},
            editReply: async (payload) => {
                const content = typeof payload === "string" ? payload : payload?.content;
                if (content === undefined || content === null) {
                    throw new Error("Contenido vacío en editReply");
                }
                didSendReply = true;
                return message.channel.send(String(content));
            },
            followUp: async (payload) => {
                // Las propuestas del Duende (F-DU-03) llevan embed y botones; lo demás es solo texto.
                if (payload?.embeds || payload?.components) {
                    didSendReply = true;
                    const { content, embeds, components, allowedMentions } = payload;
                    return message.channel.send({ ...(content ? { content } : {}), embeds, components, allowedMentions });
                }
                const content = typeof payload === "string" ? payload : payload?.content;
                if (content === undefined || content === null) {
                    throw new Error("Contenido vacío en followUp");
                }
                didSendReply = true;
                return message.channel.send(String(content));
            },
            options: {
                getSubcommand: () => "talk",
                getString: (name) => {
                    if (!name) return null;
                    if (name === "texto") return effectiveText;
                    if (name === "personality") return null;
                    return null;
                },
            },
            imageAttachments,
            user: message.author,
            channel: message.channel,
            guild: isGuild ? message.guild : undefined,
            guildId: isGuild ? message.guild.id : undefined,
        };
        const t0 = Date.now();
        await duendeCommand.hablar(client, fakeInteraction);
        if (!didSendReply) {
            await message.channel.send("⚠️ No he podido responder ahora mismo. Prueba otra vez en unos segundos.");
            msgLog.warn(`Duende no envió respuesta visible; fallback aplicado · ${whoWhere(message)}`);
        }
        msgLog.info(
            `Duende respondió a "${cut(userText, 120)}"${imageAttachments.length ? ` (+${imageAttachments.length} imagen)` : ""} · ${whoWhere(message)} · ${Date.now() - t0} ms`,
        );
    } catch (error) {
        msgLog.error(`Error respondiendo como Duende · ${whoWhere(message)}`, error);
        try {
            await message.channel.send("Hubo un error al procesar tu solicitud. Intenta de nuevo más tarde.");
        } catch (e) {
            msgLog.debug(`Tampoco se pudo enviar el mensaje de error: ${e.message}`);
        }
    }
});

// Manejo de errores globales
process.on("unhandledRejection", (reason) => {
    log.error("Promesa rechazada sin capturar (unhandledRejection):", reason);
});
process.on("warning", (w) => log.warn("Aviso de Node:", w));

// Apagado ordenado: vacía los logs, cierra Discord y la BD (hace checkpoint del WAL).
let shuttingDown = false;
async function shutdown(motivo, exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Apagando El Duende (${motivo})...`);
    // Por si algo se cuelga cerrando: el proceso muere igualmente a los 5 s.
    setTimeout(() => process.exit(exitCode), 5000).unref();
    try {
        await client.destroy();
    } catch (e) {
        log.warn("Error cerrando la conexión con Discord:", e);
    }
    try {
        db.close();
    } catch (e) {
        log.warn("Error cerrando la base de datos:", e);
    }
    await flushLogs();
    process.exit(exitCode);
}

// Tras una excepción no capturada el proceso queda en un estado imposible de garantizar:
// se registra (de forma síncrona, para que no se pierda) y se sale con error. Docker
// (restart: unless-stopped) lo vuelve a levantar limpio.
process.on("uncaughtException", (err) => {
    logErrorSync("[Bot] Excepción no capturada (uncaughtException), el proceso se reinicia:", err);
    void shutdown("uncaughtException", 1);
});
process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGINT", () => void shutdown("SIGINT", 0));

// Iniciar sesión con el token del archivo .env
client
    .login(process.env.TOKEN)
    .then(() => log.info("Sesión iniciada en Discord."))
    .catch((err) => {
        log.error("Error al iniciar sesión en Discord:", err);
    });

client.on("voiceStateUpdate", (oldState, newState) => {
    try {
        xpSystem.handleVoiceStateUpdate(oldState, newState);
    } catch (e) {
        createLogger("XP").error(`Error procesando cambio de estado de voz de ${newState?.id}:`, e);
    }
});
