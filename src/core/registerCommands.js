const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
require("dotenv").config(); // Cargar el archivo .env
const { createLogger, flushLogs } = require("./logger");
const { ROOT, COMMANDS_DIR } = require("./paths");

const log = createLogger("Registro de comandos");

const guildCommands = [];

// Registra en Discord todos los slash commands de src/commands (se ejecuta antes de arrancar el bot).
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

const slashCommandsFiles = getAllJsFiles(COMMANDS_DIR);

for (const file of slashCommandsFiles) {
    const rel = path.relative(ROOT, file);
    let slash;
    try {
        slash = require(file);
    } catch (e) {
        log.error(`No se pudo cargar ${rel}; ese comando no se registrará:`, e);
        continue;
    }
    if (slash && slash.data && typeof slash.data.toJSON === "function") {
        const data = slash.data.toJSON();
        if (data && data.name) {
            guildCommands.push(data);
        } else {
            log.error(`El comando en ${rel} no tiene nombre definido. ${JSON.stringify(data)}`);
        }
    } else if (slash && Object.keys(slash).length > 0) {
        log.warn(`${rel} no exporta un comando (sin "data"): se ignora`);
    }
}
log.info(`${guildCommands.length} comandos: ${guildCommands.map((c) => c && c.name).join(", ")}`);

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// Ejecuta y controla la salida del proceso: success -> exit 0, error -> exit 1.
// flushLogs antes de salir: los logs se escriben con buffer y process.exit los perdería.
createSlash()
    .then(async () => {
        console.log(`✓ ${guildCommands.length} comandos registrados en Discord`);
        await flushLogs();
        process.exit(0);
    })
    .catch(async (e) => {
        log.error("Fallo registrando los comandos en Discord:", e);
        await flushLogs();
        process.exit(1);
    });

async function createSlash() {
    if (!process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.TOKEN) {
        throw new Error("Faltan TOKEN, CLIENT_ID o GUILD_ID en .env");
    }
    const t0 = Date.now();
    // Limpiar comandos globales (ya no se usan; todo se registra a nivel de guild)
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: guildCommands });
    log.info(`${guildCommands.length} comandos registrados en el servidor ${process.env.GUILD_ID} (${Date.now() - t0} ms)`);
}
