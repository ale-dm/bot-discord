// 📊 Resumen semanal para admins (F-AD-02): cada lunes, desde las 09:00 (hora de Madrid), un DM a quien recibe las
// alertas (systems/alertas: los IDs del panel o, si no hay, el dueño del servidor) con lo de los últimos 7 días:
// - ❌ Errores: los de logs/error-log*.txt de la semana, agrupados (el mismo error con otros números cuenta como uno).
// - ⌨️ Comandos más usados: las líneas "[Comando] /…" de logs/app-log*.txt de la semana (los que terminaron bien).
// - 🤖 Uso de Gemini: los contadores de 🩺 Sistema, restando los del resumen anterior (viven en memoria: si el bot se
//   reinició durante la semana, cuentan desde el arranque, y el resumen lo dice).
// - ⚽ Créditos de la Odds API: los que quedaban en la última respuesta.
// Los logs rotan por tamaño: si en una semana se escribe mucho, puede que el principio ya no esté (también se dice).
// Cron cada hora de los lunes y al arrancar: una vez por semana (tabla config, resumen_admin_semana), aunque el bot
// se reinicie. Vista previa en /paneladmin → 🩺 Sistema → 🔔 Alertas → 📊 Resumen semanal.
const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const db = require("../core/db");
const alertas = require("./alertas");
const { sendDm } = require("./xp/rachas");
const { createLogger, getLogStats } = require("../core/logger");
const { getUsage } = require("../services/geminiClient");
const { creditosRestantes, CREDITOS_AVISO } = require("../services/oddsApi");

const log = createLogger("Resumen");

const HORA = 9;
const DIAS = 7;
const DIA_MS = 86400 * 1000;
const CLAVE = "resumen_admin_semana";

const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
});
/** { dia, hora, lunes } en Madrid. */
function momento(ahora) {
    const p = Object.fromEntries(formato.formatToParts(new Date(ahora)).map((x) => [x.type, x.value]));
    return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), lunes: p.weekday === "Mon" };
}

// Los mismos que usa el logger para rotar (core/logger): más allá del último, lo antiguo se borra.
const LOG_MAX_FILES = Math.max(1, Number(process.env.LOG_MAX_FILES || 5));

/**
 * Las líneas de un log (app o error, con sus rotados) escritas desde `desde` (ms). `principioPerdido`: ya se han borrado
 * rotados (existe el último) y ninguna línea es anterior a `desde`, así que parte de la semana puede faltar.
 */
function lineasDesde(tipo, desde, dir = getLogStats().dir) {
    const lineas = [];
    let hayAnteriores = false;
    let ultimoRotado = false;
    // Del más antiguo al actual, para que salgan en orden.
    for (let n = LOG_MAX_FILES; n >= 0; n--) {
        let texto;
        try {
            texto = fs.readFileSync(path.join(dir, n ? `${tipo}-log.${n}.txt` : `${tipo}-log.txt`), "utf8");
        } catch {
            continue;
        }
        if (n === LOG_MAX_FILES) ultimoRotado = true;
        for (const linea of texto.split("\n")) {
            const ts = Date.parse(linea.slice(0, 24));
            if (!Number.isFinite(ts)) continue; // continuaciones de una traza
            if (ts < desde) hayAnteriores = true;
            else lineas.push(linea);
        }
    }
    return { lineas, principioPerdido: ultimoRotado && !hayAnteriores };
}

/** Errores de la semana agrupados: [{ texto, veces }] de más a menos, y el total. */
function errores(desde, dir) {
    const { lineas, principioPerdido } = lineasDesde("error", desde, dir);
    const grupos = new Map();
    for (const linea of lineas) {
        const m = /^\S+ ERROR (?:\[([^\]]+)\] )?(.*)$/.exec(linea);
        if (!m) continue;
        const texto = `${m[1] ? `[${m[1]}] ` : ""}${m[2]}`.replace(/\d+/g, "#").slice(0, 120);
        grupos.set(texto, (grupos.get(texto) || 0) + 1);
    }
    const lista = [...grupos.entries()].map(([texto, veces]) => ({ texto, veces })).sort((a, b) => b.veces - a.veces);
    return { total: lista.reduce((s, e) => s + e.veces, 0), lista, principioPerdido };
}

/** Comandos que terminaron bien esta semana: [{ comando, veces }] de más a menos. */
function comandos(desde, dir) {
    const { lineas, principioPerdido } = lineasDesde("app", desde, dir);
    const cuenta = new Map();
    for (const linea of lineas) {
        const m = /^\S+ INFO {2}\[Comando\] \/(\S+)/.exec(linea);
        if (!m || linea.includes("denegado por ACL")) continue;
        cuenta.set(m[1], (cuenta.get(m[1]) || 0) + 1);
    }
    const lista = [...cuenta.entries()].map(([comando, veces]) => ({ comando, veces })).sort((a, b) => b.veces - a.veces);
    return { total: lista.reduce((s, c) => s + c.veces, 0), lista, principioPerdido };
}

// Contadores de Gemini en el último resumen enviado (en memoria, como los propios contadores).
let geminiAnterior = null;

/** Uso de Gemini desde el resumen anterior (o desde el arranque, si el bot se reinició después). */
function usoGemini(arranque = Date.now() - process.uptime() * 1000) {
    const ahora = getUsage();
    const base = geminiAnterior || { llamadas: 0, errores: 0, cuotaAgotada: 0, tokensEntrada: 0, tokensSalida: 0 };
    const resta = Object.fromEntries(Object.entries(ahora).map(([k, v]) => [k, v - (base[k] || 0)]));
    return { ...resta, desdeArranque: !geminiAnterior, arranque };
}

const fmt = (n) => Number(n || 0).toLocaleString("es");

/** El resumen de los últimos 7 días, como embed. */
function construir(ahora = Date.now(), { dir } = {}) {
    const desde = ahora - DIAS * DIA_MS;
    const e = errores(desde, dir);
    const c = comandos(desde, dir);
    const g = usoGemini();
    const odds = creditosRestantes();
    const lineasErrores = e.lista.slice(0, 5).map((x) => `• ${x.veces}× ${x.texto}`);
    const embed = new EmbedBuilder()
        .setTitle("📊 Resumen semanal del bot")
        .setDescription(`Lo de los últimos ${DIAS} días (desde <t:${Math.floor(desde / 1000)}:f>).`)
        .addFields(
            {
                name: `❌ Errores: ${fmt(e.total)}`,
                value: (e.total
                    ? lineasErrores.join("\n") + (e.lista.length > 5 ? `\n…y ${e.lista.length - 5} distintos más` : "")
                    : "Ninguno. 🎉"
                ).slice(0, 1024),
            },
            {
                name: `⌨️ Comandos más usados: ${fmt(c.total)} en total`,
                value: c.total
                    ? c.lista
                          .slice(0, 5)
                          .map((x, i) => `${i + 1}. \`/${x.comando}\` · ${fmt(x.veces)}`)
                          .join("\n")
                    : "Ninguno.",
            },
            {
                name: "🤖 Gemini",
                value:
                    `${fmt(g.llamadas)} llamadas · ${fmt(g.errores)} errores (${fmt(g.cuotaAgotada)} por cuota) · tokens ` +
                    `${fmt(g.tokensEntrada)} de entrada / ${fmt(g.tokensSalida)} de salida` +
                    (g.desdeArranque ? `\n_Desde el arranque del bot, <t:${Math.floor(g.arranque / 1000)}:R>._` : ""),
            },
            {
                name: "⚽ Odds API",
                value:
                    odds.restantes === null
                        ? "Sin consultar desde el arranque."
                        : `**${fmt(odds.restantes)}** créditos restantes este mes${odds.restantes < CREDITOS_AVISO ? " ⚠️" : ""} (<t:${Math.floor(odds.at / 1000)}:R>)`,
            },
        )
        .setColor(e.total ? 0xe67e22 : 0x2ecc71)
        .setFooter({ text: "El Duende · llega a quien recibe las alertas (/paneladmin → 🩺 Sistema → 🔔 Alertas)" })
        .setTimestamp(ahora);
    if (e.principioPerdido || c.principioPerdido) {
        embed.addFields({ name: "ℹ️ Logs", value: "Los logs han rotado durante la semana: lo más antiguo puede faltar." });
    }
    return embed;
}

const semanaEnviada = () => db.prepare("SELECT valor FROM config WHERE clave = ?").get(CLAVE)?.valor || "";
const apuntarSemana = (dia) =>
    db.prepare("INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(CLAVE, dia);

/**
 * Cron (cada hora de los lunes) y arranque: si es lunes desde las 09:00 (Madrid) y esta semana no se ha mandado, lo
 * manda por DM a quien recibe las alertas. @returns {Promise<number>} DMs enviados
 */
async function enviarSiToca(client, ahora = Date.now(), opciones = {}) {
    const { dia, hora, lunes } = momento(ahora);
    if (!lunes || hora < HORA || semanaEnviada() === dia) return 0;
    const ids = alertas.destinatarios();
    if (!ids.length) {
        log.info("Resumen semanal sin destinatarios (alertas desactivadas)");
        return 0;
    }
    const embed = construir(ahora, opciones);
    let enviados = 0;
    for (const id of ids) {
        if (await sendDm(client, id, { embeds: [embed] })) enviados++;
    }
    apuntarSemana(dia);
    geminiAnterior = getUsage();
    log.info(`Resumen semanal enviado a ${enviados}/${ids.length} admins`);
    return enviados;
}

/** Solo para los tests. */
function _reiniciar() {
    geminiAnterior = null;
}

module.exports = { HORA, lineasDesde, errores, comandos, usoGemini, construir, enviarSiToca, _reiniciar };
