// Importar discord.js
const { Client, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const path = require("path");
require("dotenv").config();
const { createLogger, logErrorSync, flushLogs, registerSecret } = require("./core/logger");
const { whoWhere, describeCommand, componentKind, describeComponentInput, runJob } = require("./core/interactionLog");

// Cada error registrado desde aquí puede acabar en una alerta por DM a los admins (se envían al conectar).
const alertas = require("./systems/alertas");
alertas.escucharErrores();

const log = createLogger("Bot");
const cmdLog = createLogger("Comando");
const compLog = createLogger("Componente");
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

const cripto = require("./systems/cripto/mercado");
const xpSystem = require("./systems/xpSystem");
const guildSettings = require("./systems/guildSettings");
const activeGames = require("./systems/activeGames");
const { createComponentRouter } = require("./core/componentRouter");
// Mensajes de texto y filtros: src/core/mensajes.js
const { registrarMensajes } = require("./core/mensajes");
const { programarTareas } = require("./core/tareas");

const db = require("./core/db");
const { ROOT, COMMANDS_DIR, JUEGOS_DIR, PERFIL_DIR, PANELES_DIR } = require("./core/paths");

const { getAllJsFiles } = require("./core/cargarModulos");

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
    // Los juegos, las apuestas, el dinero y los paneles no son comandos (se entra por /juegos y /perfil), pero sus
    // botones sí se atienden. Los paneles solo tienen componentes cuando el panel los atiende (ver misJugadas).
    for (const file of [...getAllJsFiles(JUEGOS_DIR), ...getAllJsFiles(PERFIL_DIR), ...getAllJsFiles(PANELES_DIR)]) {
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
    programarTareas(client);

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

registrarMensajes(client);

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
