// Ayudas para registrar interacciones de Discord y tareas programadas de forma uniforme.
const { createLogger } = require("./logger");

const jobLog = createLogger("Tarea");

function cut(value, max = 80) {
    const s = String(value ?? "");
    return s.length > max ? s.slice(0, max) + "…" : s;
}

/** "usuario (id) en #canal @ servidor" — quién y dónde, en una línea corta. */
function whoWhere(interactionOrMessage) {
    const user = interactionOrMessage.user || interactionOrMessage.author;
    const channel = interactionOrMessage.channel;
    const guild = interactionOrMessage.guild;
    const u = user ? `${user.tag || user.username} (${user.id})` : "usuario desconocido";
    const c = channel ? (channel.name ? `#${channel.name}` : `canal ${channel.id}`) : "sin canal";
    const g = guild ? ` @ ${guild.name}` : " (DM)";
    return `${u} en ${c}${g}`;
}

/** Subcomando y opciones de un slash command: "/banco transferir usuario=@x cantidad=500". */
function describeCommand(interaction) {
    const parts = [`/${interaction.commandName}`];
    const walk = (opts) => {
        for (const o of opts || []) {
            if (o.type === 1 || o.type === 2) {
                // subcomando / grupo
                parts.push(o.name);
                walk(o.options);
                continue;
            }
            let v = o.value;
            if (o.user) v = `@${o.user.username}`;
            else if (o.channel) v = `#${o.channel.name || o.channel.id}`;
            else if (o.role) v = `@&${o.role.name}`;
            else if (o.attachment) v = `[adjunto ${o.attachment.name}]`;
            parts.push(`${o.name}=${cut(v)}`);
        }
    };
    walk(interaction.options?.data);
    return parts.join(" ");
}

function componentKind(interaction) {
    if (interaction.isButton?.()) return "botón";
    if (interaction.isStringSelectMenu?.()) return "select";
    if (interaction.isUserSelectMenu?.()) return "select de usuario";
    if (interaction.isRoleSelectMenu?.()) return "select de rol";
    if (interaction.isChannelSelectMenu?.()) return "select de canal";
    if (interaction.isModalSubmit?.()) return "formulario";
    return "componente";
}

/** Valores elegidos en un select, o campos enviados en un formulario (recortados). */
function describeComponentInput(interaction) {
    if (Array.isArray(interaction.values) && interaction.values.length) {
        return ` valores=[${interaction.values.map((v) => cut(v, 40)).join(", ")}]`;
    }
    if (interaction.isModalSubmit?.() && interaction.fields?.fields) {
        const campos = [...interaction.fields.fields.values()].map((f) => `${f.customId}=${cut(f.value, 60)}`);
        if (campos.length) return ` campos={${campos.join(", ")}}`;
    }
    return "";
}

/**
 * Ejecuta una tarea periódica registrando fallos con traza, y avisando si tarda mucho.
 * Nunca lanza: una tarea que falla no debe tumbar el intervalo ni el proceso.
 * @param {string} name
 * @param {() => any} fn
 * @param {{ slowMs?: number }} [opts]
 */
async function runJob(name, fn, { slowMs = 30_000 } = {}) {
    const t0 = Date.now();
    jobLog.debug(`${name}: inicio`);
    try {
        const result = await fn();
        const ms = Date.now() - t0;
        if (ms > slowMs) jobLog.warn(`${name}: terminó pero tardó ${ms} ms`);
        else jobLog.debug(`${name}: ok (${ms} ms)`);
        return result;
    } catch (e) {
        jobLog.error(`${name}: falló tras ${Date.now() - t0} ms`, e);
        return undefined;
    }
}

module.exports = { whoWhere, describeCommand, componentKind, describeComponentInput, runJob, cut };
