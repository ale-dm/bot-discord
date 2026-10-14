// Alertas por DM a los admins: errores nuevos (los que registra el logger), Odds API con pocos créditos, Gemini sin
// cuota o con un modelo que no funciona, copias de seguridad que fallan... Se configura en /paneladmin → 🩺 Sistema →
// 🔔 Alertas (activas y a quién; sin nadie puesto, al dueño del servidor).
//
// Para no inundar a nadie: la misma alerta (misma `clave`) no se repite hasta pasado su cooldown, y como mucho salen
// MAX_POR_HORA a la hora. Lo que pasa antes de conectar a Discord (errores al arrancar) se guarda y se manda al
// conectar. Aquí nunca se registra nada como error: un fallo al avisar de un error no puede generar otra alerta.
const { embedAlerta } = require("../discord/mensajes/alerta");
const guildSettings = require("./guildSettings");
const { intentarDm } = require("./avisosDm");
const { createLogger, onError } = require("../core/logger");

const log = createLogger("Alertas");

const HORA = 60 * 60 * 1000;
const COOLDOWN_POR_DEFECTO = 6 * HORA;
const MAX_POR_HORA = 10;
const MAX_PENDIENTES = 10;

// Categorías de alerta que se pueden apagar por separado (#422); salen del principio de la clave de cada alerta («error:…»,
// «gemini-cuota», «odds-creditos», «backup:integridad»). El resumen semanal no es una categoría: tiene su propio envío.
const CATEGORIAS = {
    error: "❌ Errores nuevos",
    gemini: "🤖 Gemini (cuota o modelo roto)",
    odds: "📈 Créditos de la Odds API",
    backup: "💾 Copias de seguridad",
};

/** La categoría de una alerta según su clave, o null si no es de ninguna (la prueba del panel, por ejemplo). */
function categoriaDe(clave) {
    const base = /^[a-z]+/.exec(String(clave))?.[0];
    return CATEGORIAS[base] ? base : null;
}

/** ¿Tiene este servidor activa esa categoría? Sin categoría (null), siempre. */
const categoriaActiva = (cfg, categoria) => !categoria || guildSettings.parseCsvIds(cfg.tipos).includes(categoria);

// Títulos más claros para los errores de algunos módulos.
const TITULOS_POR_AMBITO = { Backups: "💾 La copia de seguridad ha fallado" };

let client = null;
let dejarDeEscuchar = null;
const ultimaPorClave = new Map();
const enviadasUltimaHora = [];
const pendientes = [];
const historial = [];

/** Mismo error con distintos ids o números = misma alerta. */
const normalizar = (texto) =>
    String(texto || "")
        .replace(/\d+/g, "#")
        .slice(0, 150);

/** Empieza a convertir en alerta cada error que se registre. Se llama al arrancar, antes de cargar los comandos. */
function escucharErrores() {
    if (dejarDeEscuchar) return;
    dejarDeEscuchar = onError(({ scope, message }) => {
        if (scope === "Alertas") return;
        alertar({
            clave: `error:${scope || ""}:${normalizar(message)}`,
            titulo: TITULOS_POR_AMBITO[scope] || "❌ Error nuevo en el bot",
            detalle: `${scope ? `[${scope}] ` : ""}${message}\n\nEl detalle está en logs/error-log.txt.`,
        }).catch((e) => log.warn(`No se pudo enviar la alerta de un error: ${e.message}`));
    });
}

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

async function enviar({ titulo, detalle, at = Date.now(), categoria = null }) {
    const ids = destinatarios(categoria);
    if (!ids.length) {
        log.info(`Alerta sin destinatarios (alertas o categoría desactivadas): ${titulo}`);
        return 0;
    }
    const embed = embedAlerta(titulo, detalle, at);
    let enviadas = 0;
    let cerrados = 0;
    for (const id of ids) {
        const resultado = await intentarDm(client, id, { embeds: [embed] });
        if (resultado === "ok") enviadas++;
        else if (resultado === "cerrado") cerrados++;
    }
    // Si nadie la recibió por tener los DMs cerrados, va al canal de respaldo; otros errores no son motivo para publicarla.
    const enCanal = !enviadas && cerrados ? await publicarEnCanalDeRespaldo(embed, categoria) : 0;
    historial.unshift({ at, titulo, enviadas, destinatarios: ids.length, enCanal });
    historial.length = Math.min(historial.length, 10);
    log.info(
        `Alerta "${titulo}" enviada a ${enviadas}/${ids.length} admins${enCanal ? ` y publicada en ${enCanal} canal(es) de respaldo` : ""}`,
    );
    return enviadas;
}

/**
 * Avisa a los admins por DM. `clave` identifica la alerta para no repetirla antes de `cooldownMs`; `forzar` se salta el
 * cooldown y el máximo por hora (la prueba del panel). @returns {Promise<number>} DMs enviados (0 si no se envió)
 */
async function alertar({ clave, titulo, detalle, cooldownMs = COOLDOWN_POR_DEFECTO, forzar = false }) {
    const ahora = Date.now();
    // Una categoría apagada en todos los servidores no envía nada ni gasta el cooldown ni el máximo por hora (#422).
    const categoria = categoriaDe(clave);
    if (client && categoria && !destinatarios(categoria).length) return 0;
    if (!forzar) {
        const ultima = ultimaPorClave.get(clave);
        if (ultima && ahora - ultima < cooldownMs) return 0;
        while (enviadasUltimaHora.length && ahora - enviadasUltimaHora[0] > HORA) enviadasUltimaHora.shift();
        if (enviadasUltimaHora.length >= MAX_POR_HORA) {
            log.warn(`Alerta no enviada (máximo de ${MAX_POR_HORA} por hora): ${titulo}`);
            return 0;
        }
    }
    ultimaPorClave.set(clave, ahora);
    if (!client) {
        if (pendientes.length < MAX_PENDIENTES) pendientes.push({ titulo, detalle, at: ahora, categoria });
        return 0;
    }
    if (!forzar) enviadasUltimaHora.push(ahora);
    return enviar({ titulo, detalle, at: ahora, categoria });
}

/** Conectado a Discord: desde ahora se envían, y se mandan las que se guardaron al arrancar. */
async function iniciar(discordClient) {
    client = discordClient;
    const guardadas = pendientes.splice(0);
    for (const p of guardadas) await enviar(p);
}

/** Para el panel: estado, destinatarios y últimas alertas enviadas desde el arranque. */
function estado(guildId) {
    const cfg = guildSettings.getSettings(guildId).alertas;
    return {
        activas: Boolean(cfg.enabled),
        adminIds: guildSettings.parseCsvIds(cfg.admin_ids),
        tipos: guildSettings.parseCsvIds(cfg.tipos),
        canal: cfg.canal || null,
        historial: [...historial],
    };
}

/** Alerta de prueba (botón 📨 Probar del panel). */
function probar(quien) {
    return alertar({
        clave: `prueba:${Date.now()}`,
        titulo: "🔔 Alerta de prueba",
        detalle: `${quien} ha probado las alertas desde el panel de admin. Si te llega esto, llegarán también las de verdad.`,
        forzar: true,
    });
}

/** Solo para los tests. */
function _reiniciar() {
    client = null;
    ultimaPorClave.clear();
    enviadasUltimaHora.length = 0;
    pendientes.length = 0;
    historial.length = 0;
}

module.exports = { CATEGORIAS, categoriaDe, escucharErrores, iniciar, alertar, destinatarios, estado, probar, _reiniciar, MAX_POR_HORA };
