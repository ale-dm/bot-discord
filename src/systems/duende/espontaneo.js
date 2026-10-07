// Mensajes espontáneos del Duende: de vez en cuando, sin que nadie le hable, se dirige a
// alguien que conoce (perfiles de /duende recuerda) para picarle y que conteste. Pedido porque
// el server estaba "un poco muerto". Solo cuando el canal lleva un rato sin mensajes de verdad:
// la idea es levantar un server parado, no interrumpir una conversación que ya está viva.
const guildSettings = require("../guildSettings");
const perfiles = require("./perfiles");
const { buildPersonProfileText } = require("./personas");
const { generarConGemini } = require("../../services/duende/gemini");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Espontaneo");

const PROB = Number(process.env.DUENDE_ESPONTANEO_PROB || 0.15);
const QUIET_MS = Number(process.env.DUENDE_ESPONTANEO_QUIET_MS || 2 * 60 * 60 * 1000);

// Cada gancho devuelve { texto, discordId? } con algo real para que el Duende hable, o null si
// no aplica ahora. discordId es opcional: si está, se menciona a esa persona (la mención la
// pone revisarGuild, no Gemini, para no depender de que el modelo copie bien un ID).
const GANCHOS = [
    function personaAlAzar() {
        const candidatos = perfiles.listarPerfiles().filter((p) => p.discordId && (p.description || p.notas.length));
        if (!candidatos.length) return null;
        const p = candidatos[Math.floor(Math.random() * candidatos.length)];
        return { texto: buildPersonProfileText(p), discordId: p.discordId };
    },
];

/** @returns {{texto: string, discordId?: string}|null} un gancho al azar entre los que aplican ahora, o null si no hay ninguno */
function elegirGancho() {
    const aplican = GANCHOS.map((g) => g()).filter(Boolean);
    if (!aplican.length) return null;
    return aplican[Math.floor(Math.random() * aplican.length)];
}

/** Convierte el gancho elegido en un mensaje corto con la personalidad del canal. Sin la mención: la añade revisarGuild. */
async function generarMensaje(channelId, gancho) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    const parts = [
        {
            text:
                `${base} Vas a dirigirte tú solo a una persona concreta, sin que te haya hablado, en un server de ` +
                "Discord un poco parado últimamente. El objetivo es picarla para que conteste o haga algo (no sonar " +
                "a aviso de sistema ni a mensaje genérico). Habla en segunda persona, directamente a ella, en tu " +
                "estilo, 1-2 frases, usando solo lo que sabes de ella aquí abajo — no inventes nada más. No pongas " +
                "menciones ni arrobas: quien envía el mensaje ya se encarga de avisarla.",
        },
        { text: `Lo que sabes de ella: ${gancho.texto}` },
    ];
    return generarConGemini(parts, { maxTokens: 200 });
}

/** @returns {Promise<boolean>} true si el canal lleva QUIET_MS sin un mensaje humano reciente */
async function canalEnCalma(channel) {
    try {
        const ultimos = await channel.messages.fetch({ limit: 1 });
        const ultimo = ultimos.first();
        if (!ultimo) return true;
        return Date.now() - ultimo.createdTimestamp > QUIET_MS;
    } catch (e) {
        log.debug(`No se pudo comprobar la actividad del canal ${channel.id}: ${e.message}`);
        return false; // si no se puede comprobar, mejor no molestar
    }
}

async function revisarGuild(client, guild) {
    const d = guildSettings.getSettings(guild.id).duende;
    if (!d.espontaneo_enabled || !d.espontaneo_channel_id) return;
    if (Math.random() >= PROB) return;

    const channel = await guild.channels.fetch(d.espontaneo_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    if (!(await canalEnCalma(channel))) return;

    const gancho = elegirGancho();
    if (!gancho) return; // nadie con perfil al que dirigirse: mejor callado que un mensaje soso

    try {
        const texto = await generarMensaje(channel.id, gancho);
        const mencion = gancho.discordId ? `<@${gancho.discordId}> ` : "";
        await channel.send(`${mencion}${texto}`);
        log.info(`Mensaje espontáneo en ${guild.name} (${channel.name}) dirigido a ${gancho.discordId || "?"}`);
    } catch (e) {
        log.warn(`No se pudo generar/enviar el mensaje espontáneo en ${guild.name}: ${e.message}`);
    }
}

async function revisarTodos(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            await revisarGuild(client, guild);
        } catch (e) {
            log.warn(`Error revisando mensajes espontáneos en ${guild.name}: ${e.message}`);
        }
    }
}

module.exports = { revisarTodos, revisarGuild, elegirGancho, generarMensaje, canalEnCalma, GANCHOS, PROB, QUIET_MS };
