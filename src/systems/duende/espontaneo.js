// Mensajes espontáneos del Duende: de vez en cuando, sin que nadie le hable, comenta algo real
// del server para animar a la gente a usarlo (apostar, comprar en la tienda...). Pedido porque
// el server estaba "un poco muerto". Solo cuando el canal lleva un rato sin mensajes de verdad:
// la idea es levantar un server parado, no interrumpir una conversación que ya está viva.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const dinero = require("../dinero");
const perfiles = require("./perfiles");
const { generarConGemini } = require("../../services/duende/gemini");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Espontaneo");

const PROB = Number(process.env.DUENDE_ESPONTANEO_PROB || 0.15);
const QUIET_MS = Number(process.env.DUENDE_ESPONTANEO_QUIET_MS || 2 * 60 * 60 * 1000);

// Cada gancho mira algo real y devuelve una frase factual (en qué se basa el Duende), o null si
// no aplica ahora. No duplican las herramientas del Duende (services/duende/herramientas.js):
// esas miran a UNA persona que pregunta; estas miran al server entero para encontrar algo que
// comentar sin que nadie haya preguntado nada.
const GANCHOS = [
    function tiendaSinVender() {
        const fila = db
            .prepare(
                `SELECT o.nombre, t.precio FROM tienda t
                 JOIN objeto o ON o.id = t.objetoId
                 WHERE (t.stock IS NULL OR t.stock > 0)
                   AND NOT EXISTS (SELECT 1 FROM inventario i WHERE i.itemId = o.id)
                 ORDER BY t.id ASC LIMIT 1`,
            )
            .get();
        if (!fila) return null;
        return `Nadie ha comprado nunca "${fila.nombre}" de la tienda (${fila.precio} monedas), aunque sigue a la venta.`;
    },
    function apuestaConPocaGente() {
        const fila = db
            .prepare(
                `SELECT p.home_team, p.away_team, COUNT(DISTINCT u.user_id) AS apostantes
                 FROM apuestas_partidos p
                 LEFT JOIN apuestas_usuario u ON u.match_id = p.match_id
                 WHERE p.start_time > datetime('now') AND p.start_time < datetime('now', '+2 days')
                 GROUP BY p.id
                 HAVING apostantes <= 1
                 ORDER BY p.start_time ASC LIMIT 1`,
            )
            .get();
        if (!fila) return null;
        return `Casi nadie ha apostado todavía al ${fila.home_team}-${fila.away_team}, que empieza en menos de 2 días.`;
    },
    function rankingDinero() {
        const [top] = dinero.masRicos(1);
        if (!top || !top.total) return null;
        return `<@${top.userId}> es quien más dinero tiene acumulado del server ahora mismo (${top.total.toLocaleString("es")} monedas entre efectivo y banco).`;
    },
];

/** @returns {string|null} un hecho real al azar entre los que aplican ahora, o null si no hay ninguno */
function elegirGancho() {
    const aplican = GANCHOS.map((g) => g()).filter(Boolean);
    if (!aplican.length) return null;
    return aplican[Math.floor(Math.random() * aplican.length)];
}

/** Convierte el hecho elegido en un mensaje corto con la personalidad del canal. */
async function generarMensaje(channelId, hecho) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    const parts = [
        {
            text:
                `${base} Vas a soltar un mensaje tú solo, sin que nadie te haya hablado, en un server de Discord ` +
                "un poco parado últimamente. El objetivo es animar a la gente a usar el bot (apostar, comprar en " +
                "la tienda, etc.), nunca sonar a aviso de sistema ni a anuncio. Usa este dato real para pincharles, " +
                "en tu estilo, 1-2 frases, sin inventarte nada que no esté en el dato.",
        },
        { text: `Dato: ${hecho}` },
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

    const hecho = elegirGancho();
    if (!hecho) return; // nada interesante que decir: mejor callado que un mensaje soso

    try {
        const texto = await generarMensaje(channel.id, hecho);
        await channel.send(texto);
        log.info(`Mensaje espontáneo en ${guild.name} (${channel.name}): ${hecho}`);
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
