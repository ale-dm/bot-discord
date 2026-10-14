// Mensajes espontáneos del Duende: de vez en cuando, sin que nadie le hable, se dirige a
// alguien que conoce (perfiles de /duende recuerda) para picarle y que conteste. Pedido porque
// el server estaba "un poco muerto". Solo cuando el canal lleva un rato sin mensajes de verdad:
// la idea es levantar un server parado, no interrumpir una conversación que ya está viva.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const perfiles = require("./perfiles");
const { buildPersonProfileText } = require("./personas");
const { generarConGemini } = require("../../services/duende/gemini");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Espontaneo");

const PROB = Number(process.env.DUENDE_ESPONTANEO_PROB || 0.15);
const QUIET_MS = Number(process.env.DUENDE_ESPONTANEO_QUIET_MS || 2 * 60 * 60 * 1000);
// Cuánto tiene que pasar antes de dirigirse otra vez a la misma persona (#400), en horas. Se guarda en la base de datos: sobrevive a los reinicios.
const ENFRIAMIENTO_MS = Number(process.env.DUENDE_ESPONTANEO_ENFRIAMIENTO_H || 24) * 60 * 60 * 1000;

/** A quién se ha dirigido un mensaje espontáneo hace menos del plazo: Set de Discord IDs. */
function enEspera(guildId, ahora = Date.now()) {
    return new Set(
        db
            .prepare("SELECT userId FROM duende_espontaneo_dirigidos WHERE guildId = ? AND ultima > ?")
            .all(String(guildId), ahora - ENFRIAMIENTO_MS)
            .map((r) => r.userId),
    );
}

/** Apunta que acaba de dirigirse un mensaje espontáneo a esta persona. */
function marcarDirigido(guildId, userId, ahora = Date.now()) {
    db.prepare(
        "INSERT INTO duende_espontaneo_dirigidos (guildId, userId, ultima) VALUES (?, ?, ?) ON CONFLICT(guildId, userId) DO UPDATE SET ultima = excluded.ultima",
    ).run(String(guildId), String(userId), ahora);
}

// Cada gancho devuelve { texto, discordId? } con algo real para que el Duende hable, o null si
// no aplica ahora. discordId es opcional: si está, se menciona a esa persona (la mención la
// pone revisarGuild, no Gemini, para no depender de que el modelo copie bien un ID).
const GANCHOS = [
    // `excluir`: a quien no hay que dirigirse ahora (está en espera o acaba de escribir en el canal).
    function personaAlAzar(excluir = new Set()) {
        const candidatos = perfiles
            .listarPerfiles()
            .filter((p) => p.discordId && (p.description || p.notas.length) && !excluir.has(String(p.discordId)));
        if (!candidatos.length) return null;
        const p = candidatos[Math.floor(Math.random() * candidatos.length)];
        return { texto: buildPersonProfileText(p), discordId: p.discordId };
    },
];

/** @returns {{texto: string, discordId?: string}|null} un gancho al azar entre los que aplican ahora, o null si no hay ninguno */
function elegirGancho(excluir = new Set()) {
    const aplican = GANCHOS.map((g) => g(excluir)).filter(Boolean);
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
    // thinkingBudget: 0 — igual que en trabajo.js: una frase suelta no necesita "pensar", y si
    // piensa se come el maxTokens antes de escribir nada visible.
    return generarConGemini(parts, { maxTokens: 400, thinkingBudget: 0 });
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

/** El último mensaje del canal es de esta persona (para no dirigirse justo a quien acaba de escribir). null si no se sabe. */
async function ultimoAutor(channel) {
    try {
        return (await channel.messages.fetch({ limit: 1 })).first()?.author?.id ?? null;
    } catch {
        return null;
    }
}

async function revisarGuild(client, guild) {
    const d = guildSettings.getSettings(guild.id).duende;
    if (!d.espontaneo_enabled || !d.espontaneo_channel_id) return;
    if (Math.random() >= PROB) return;

    const channel = await guild.channels.fetch(d.espontaneo_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    if (!(await canalEnCalma(channel))) return;

    const excluir = enEspera(guild.id);
    const reciente = await ultimoAutor(channel);
    if (reciente) excluir.add(String(reciente));
    const gancho = elegirGancho(excluir);
    if (!gancho) return; // nadie con perfil al que dirigirse (o todos en espera): mejor callado que un mensaje soso

    try {
        const texto = await generarMensaje(channel.id, gancho);
        const mencion = gancho.discordId ? `<@${gancho.discordId}> ` : "";
        await channel.send(`${mencion}${texto}`);
        if (gancho.discordId) marcarDirigido(guild.id, gancho.discordId);
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

module.exports = {
    revisarTodos,
    revisarGuild,
    elegirGancho,
    generarMensaje,
    canalEnCalma,
    enEspera,
    marcarDirigido,
    GANCHOS,
    QUIET_MS,
    ENFRIAMIENTO_MS,
};
