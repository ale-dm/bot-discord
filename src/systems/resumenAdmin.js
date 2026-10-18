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
const db = require("../core/db");
const { getLogStats } = require("../core/logger");
const { getUsage } = require("../services/geminiClient");
const { creditosRestantes, CREDITOS_AVISO } = require("../services/oddsApi");

const HORA = 9;
const DIAS = 7;
const DIA_MS = 86400 * 1000;
const CLAVE = "resumen_admin_semana";

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

/** Los datos del resumen de los últimos 7 días (los pinta src/discord/mensajes/resumenSemanal). */
function construir(ahora = Date.now(), { dir } = {}) {
    const desde = ahora - DIAS * DIA_MS;
    const e = errores(desde, dir);
    const c = comandos(desde, dir);
    const g = usoGemini();
    const odds = creditosRestantes();
    return { ahora, desde, dias: DIAS, e, c, g, odds, creditosAviso: CREDITOS_AVISO };
}

const semanaEnviada = () => db.prepare("SELECT valor FROM config WHERE clave = ?").get(CLAVE)?.valor || "";
const apuntarSemana = (dia) =>
    db.prepare("INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(CLAVE, dia);

/** El resumen ya se ha mandado: desde el siguiente, Gemini cuenta solo lo nuevo. */
function marcarEnviado() {
    geminiAnterior = getUsage();
}

/** Solo para los tests. */
function _reiniciar() {
    geminiAnterior = null;
}

module.exports = { HORA, errores, comandos, usoGemini, construir, semanaEnviada, apuntarSemana, marcarEnviado, _reiniciar };
