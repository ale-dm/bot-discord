// Transporte de las alertas de administración (#472): manda los DMs a quien toca y publica en el canal de respaldo.
// El sistema (src/systems/alertas.js) decide qué alertar y lleva el cooldown; aquí solo se pinta y se envía.
const guildSettings = require("../../systems/guildSettings");
const { intentarDm } = require("../../systems/avisosDm");
const { categoriaActiva, usarTransporte, iniciar } = require("../../systems/alertas");
const { embedAlerta } = require("../mensajes/alerta");
const { createLogger } = require("../../core/logger");

const log = createLogger("Alertas");

let client = null;

/** IDs de quienes reciben las alertas, de todos los servidores con las alertas activas (y con esa categoría, si se indica). */
function destinatarios(categoria = null) {
    if (!client) return [];
    const ids = new Set();
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).alertas;
        if (!cfg.enabled || !categoriaActiva(cfg, categoria)) continue;
        const propios = guildSettings.parseCsvIds(cfg.admin_ids);
        for (const id of propios.length ? propios : [guild.ownerId].filter(Boolean)) ids.add(String(id));
    }
    return [...ids];
}

/** Publica la alerta en el canal de respaldo de cada servidor que lo tiene puesto (#423). Un fallo solo se registra. */
async function publicarEnCanalDeRespaldo(embed, categoria) {
    let publicadas = 0;
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).alertas;
        if (!cfg.enabled || !cfg.canal || !categoriaActiva(cfg, categoria)) continue;
        try {
            const canal = await client.channels.fetch(cfg.canal);
            await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
            publicadas++;
        } catch (e) {
            log.warn(`No se pudo publicar la alerta en el canal de respaldo ${cfg.canal} de ${guild.id}: ${e.message}`);
        }
    }
    return publicadas;
}

/** Manda una alerta a cada destinatario y, si nadie la recibió por tener los DMs cerrados, la publica en el canal de respaldo. */
async function enviar({ titulo, detalle, at, categoria }) {
    const embed = embedAlerta(titulo, detalle, at);
    let enviadas = 0;
    let cerrados = 0;
    for (const id of destinatarios(categoria)) {
        const resultado = await intentarDm(client, id, { embeds: [embed] });
        if (resultado === "ok") enviadas++;
        else if (resultado === "cerrado") cerrados++;
    }
    const enCanal = !enviadas && cerrados ? await publicarEnCanalDeRespaldo(embed, categoria) : 0;
    return { enviadas, enCanal };
}

/** Conectado a Discord: instala el transporte y manda las alertas que se guardaron al arrancar. */
async function iniciarAlertas(discordClient) {
    client = discordClient;
    usarTransporte({ destinatarios, enviar });
    await iniciar();
}

module.exports = { iniciar: iniciarAlertas, destinatarios };
