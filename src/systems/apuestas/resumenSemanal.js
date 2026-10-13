// 📊 Resumen semanal de apuestas por DM (#361): cada lunes, desde las 10:00 (hora de Madrid), un mensaje privado a quien tuvo apuestas
// resueltas la semana anterior (de lunes a domingo): lo apostado, lo cobrado, el beneficio y su puesto en la 🏅 liga de pronósticos. Las
// cifras salen de ranking.beneficioEntre, la misma consulta de la clasificación semanal. Se manda una sola vez por persona y semana
// (apuestas_resumen_semanal, migración 062), aunque el bot se reinicie. Se puede apagar en /avisos.
const db = require("../../core/db");
const { momentoMadrid, diaSemana, semanaAnterior, aFecha } = require("../../core/zonaMadrid");
const { fmtNumero } = require("../../core/formato");
const { enviarAviso } = require("../avisosDm");
const { createLogger } = require("../../core/logger");
const { beneficioEntre } = require("./ranking");
const liga = require("./liga");

const log = createLogger("Apuestas");

const HORA = 10;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const signo = (n) => `${n > 0 ? "+" : ""}${fmtNumero(n)}`;

const fechaCorta = (dia) => `${aFecha(dia).getUTCDate()} de ${MESES[aFecha(dia).getUTCMonth()]}`;

/** Quién tiene apuestas resueltas en esa semana, con sus cifras: [{ userId, beneficio, resueltas, apostado, cobrado }]. */
const cifrasDeLaSemana = (semana) => beneficioEntre(semana.lunes, semana.domingo);

/** El mensaje de una persona: sus cifras de la semana y su puesto en la liga de la temporada (si ha sumado puntos). */
function mensaje(cifras, semana, puesto) {
    const n = cifras.resueltas;
    const liga_ = puesto
        ? `🏅 Liga de pronósticos: **${puesto.posicion}.º** con **${fmtNumero(puesto.puntos)}** ${puesto.puntos === 1 ? "punto" : "puntos"}.`
        : "🏅 Liga de pronósticos: todavía sin puntos esta temporada.";
    return (
        `📊 **Tu semana de apuestas** · del ${fechaCorta(semana.lunes)} al ${fechaCorta(semana.domingo)}\n` +
        `Apuestas resueltas: **${n}**\n` +
        `💵 Apostado: **${fmtNumero(cifras.apostado)}** 🪙 · cobrado: **${fmtNumero(cifras.cobrado)}** 🪙\n` +
        `${cifras.beneficio >= 0 ? "📈" : "📉"} Beneficio: **${signo(cifras.beneficio)}** 🪙\n` +
        `${liga_}\n\nTodo el detalle, en /juegos → 📋 Mis jugadas y 📊 Stats.`
    );
}

/** La posición en la liga (con puntos) de cada persona de la temporada de `ahora`: Map userId → { posicion, puntos }. */
function posicionesLiga(ahora) {
    const mapa = new Map();
    liga.clasificacion(liga.temporadaDe(ahora), 100000).forEach((r, i) =>
        mapa.set(String(r.userId), { posicion: i + 1, puntos: r.puntos }),
    );
    return mapa;
}

/** Anota que se le manda el resumen de esa semana; false si ya se había anotado (no se repite). */
function marcar(userId, semana, ahora) {
    return (
        db
            .prepare("INSERT OR IGNORE INTO apuestas_resumen_semanal (userId, semana, enviado_en) VALUES (?, ?, ?)")
            .run(String(userId), semana.lunes, ahora).changes === 1
    );
}

/**
 * Cron (cada hora de los lunes) y arranque: desde las 10:00 del lunes, manda el resumen de la semana anterior a quien tuvo apuestas
 * resueltas y aún no lo ha recibido. Se anota antes de mandar: unos DM cerrados no se reintentan cada hora.
 * @returns {Promise<number>} DMs enviados
 */
async function enviarSiToca(client, ahora = Date.now()) {
    const { dia, hora } = momentoMadrid(ahora);
    if (diaSemana(dia) !== 1 || hora < HORA) return 0;
    const semana = semanaAnterior(ahora);
    const cifras = cifrasDeLaSemana(semana);
    if (!cifras.length) return 0;
    const posiciones = posicionesLiga(ahora);
    let enviados = 0;
    for (const c of cifras) {
        if (!marcar(c.userId, semana, ahora)) continue;
        if (await enviarAviso(client, c.userId, "resumen_apuestas", { content: mensaje(c, semana, posiciones.get(String(c.userId))) }))
            enviados++;
    }
    if (enviados) log.info(`Resumen semanal de apuestas (${semana.lunes}): ${enviados} DMs`);
    return enviados;
}

module.exports = { HORA, cifrasDeLaSemana, mensaje, enviarSiToca };
