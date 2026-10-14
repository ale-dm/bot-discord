// Recordatorios por DM de las apuestas (cron cada 5 min en app/tareas.js). Se configuran en /paneladmin → ⚽ Apuestas:
// - Antes de un partido al que se ha apostado (apuestas.recordatorio y _min): cada apuesta se recuerda una sola vez
//   (apuestas_usuario.recordado); quien tenga varias en partidos que empiezan pronto recibe un único mensaje con todas.
// - Una quiniela sin enviar (#340, apuestas.recordatorio_quiniela_horas): unas horas antes de que se cierre, a quien suele jugarlas
//   (ha apostado en alguna otra, o tiene un borrador de esta) y aún no ha enviado la de la jornada. Una vez por quiniela y persona.
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { enviarAviso } = require("../avisosDm");
const { DEPORTES } = require("../../services/oddsApi");
const { QUINIELA_LOCK_MINUTES } = require("./quinielas");
const { marcadorDe } = require("./marcador");
const mercados = require("./mercados");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

// Las apuestas no son por servidor: vale la configuración del primer servidor que lo tenga activado.
function configuracion(client) {
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).apuestas;
        if (cfg.recordatorio) return { minutos: Math.max(5, Math.min(24 * 60, Number(cfg.recordatorio_min) || 30)) };
    }
    return null;
}

function eleccionTexto(a) {
    if (mercados.esMercado(a.eleccion)) return mercados.textoEleccion(a).toLowerCase();
    if (marcadorDe(a.eleccion)) return `marcador exacto ${marcadorDe(a.eleccion)}`;
    if (a.eleccion === "home") return `1 (${a.home_team})`;
    if (a.eleccion === "away") return `2 (${a.away_team})`;
    return "X (empate)";
}

/** Apuestas sin recordar de partidos que empiezan dentro de los próximos `minutos`. */
function pendientesDeRecordar(minutos, ahora = Date.now()) {
    // Margen de un día en SQL (las horas son texto ISO) y la comparación exacta, con fechas de verdad.
    const filas = db
        .prepare(
            `SELECT a.id, a.user_id, a.eleccion, a.cantidad, a.cuota, p.home_team, p.away_team, p.start_time, p.deporte
             FROM apuestas_usuario a JOIN apuestas_partidos p ON a.match_id = p.match_id
             WHERE a.pagado = 0 AND a.recordado = 0 AND p.estado = 'abierto' AND p.start_time >= ?
             ORDER BY p.start_time ASC`,
        )
        .all(new Date(ahora - 24 * 3600 * 1000).toISOString());
    return filas.filter((f) => {
        const t = Date.parse(f.start_time);
        return t > ahora && t - ahora <= minutos * 60 * 1000;
    });
}

function mensaje(apuestas, minutos) {
    const lineas = apuestas.map((a) => {
        const unix = Math.floor(Date.parse(a.start_time) / 1000);
        const posible = Math.round(a.cantidad * a.cuota);
        return (
            `${DEPORTES[a.deporte]?.emoji || "⚽"} **${a.home_team} vs ${a.away_team}** a las <t:${unix}:t> (<t:${unix}:R>)\n` +
            `   Apostaste **${a.cantidad.toLocaleString("es")}** 🪙 a **${eleccionTexto(a)}** · cuota ${Number(a.cuota).toLocaleString("es", { minimumFractionDigits: 2 })} → si aciertas, **${posible.toLocaleString("es")}** 🪙`
        );
    });
    return `⏰ **En menos de ${minutos} minutos empieza${apuestas.length > 1 ? "n" : ""}:**\n${lineas.join("\n")}\n\nSíguelo en /juegos → 📋 Mis jugadas.`;
}

/** Manda los recordatorios de partidos pendientes. @returns {Promise<number>} DMs enviados */
async function enviarRecordatoriosPartidos(client, ahora) {
    const cfg = configuracion(client);
    if (!cfg) return 0;
    const apuestas = pendientesDeRecordar(cfg.minutos, ahora);
    if (!apuestas.length) return 0;

    // Se marcan antes de enviar: si un DM falla (DMs cerrados) no se reintenta cada 5 minutos.
    const marcar = db.prepare("UPDATE apuestas_usuario SET recordado = 1 WHERE id = ?");
    db.transaction(() => apuestas.forEach((a) => marcar.run(a.id)))();

    const porUsuario = new Map();
    for (const a of apuestas) porUsuario.set(a.user_id, [...(porUsuario.get(a.user_id) || []), a]);
    let enviados = 0;
    for (const [userId, suyas] of porUsuario) {
        if (await enviarAviso(client, userId, "recordatorio_partido", { content: mensaje(suyas, cfg.minutos) })) enviados++;
    }
    log.info(`Recordatorio de partidos: ${enviados}/${porUsuario.size} DMs (${apuestas.length} apuestas)`);
    return enviados;
}

// Las horas antes del cierre de la quiniela a las que se avisa (#340): las del primer servidor con el recordatorio activado. 0 = no se avisa.
function horasQuiniela(client) {
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).apuestas;
        if (cfg.recordatorio) return Math.max(0, Math.min(72, Number(cfg.recordatorio_quiniela_horas) || 0));
    }
    return 0;
}

/**
 * Las quinielas abiertas que se cierran dentro de las próximas `horas` (el cierre es QUINIELA_LOCK_MINUTES antes del primer partido) y
 * todavía no se han cerrado: nunca se avisa de una ya cerrada. Con el momento del cierre (ms).
 */
function quinielasPorCerrar(horas, ahora = Date.now()) {
    return db
        .prepare(
            `SELECT q.id, q.jornada, q.deporte, MIN(qp.start_time) AS primer FROM quinielas q
             JOIN quiniela_partidos qp ON qp.quiniela_id = q.id WHERE q.estado = 'abierta' GROUP BY q.id`,
        )
        .all()
        .map((q) => ({ ...q, cierre: Date.parse(q.primer) - QUINIELA_LOCK_MINUTES * 60 * 1000 }))
        .filter((q) => q.cierre > ahora && q.cierre - ahora <= horas * 3600 * 1000);
}

/** Quién debe recibir el aviso de una quiniela: quien juega quinielas (ha apostado en otra, o tiene un borrador de esta) y no ha enviado esta ni se le ha avisado ya. */
function aAvisarDeQuiniela(quinielaId) {
    return db
        .prepare(
            `SELECT userId FROM (
                 SELECT user_id AS userId FROM quiniela_apuestas WHERE quiniela_id != @q
                 UNION SELECT userId FROM quiniela_borrador WHERE quinielaId = @q
             )
             WHERE userId NOT IN (SELECT user_id FROM quiniela_apuestas WHERE quiniela_id = @q)
               AND userId NOT IN (SELECT userId FROM quiniela_recordadas WHERE quinielaId = @q)`,
        )
        .all({ q: quinielaId })
        .map((f) => f.userId);
}

function mensajeQuiniela(q, borrador) {
    const unix = Math.floor(q.cierre / 1000);
    const deporte = DEPORTES[q.deporte] || DEPORTES.laliga;
    return (
        `🧾 **Te falta enviar la quiniela ${q.jornada}** (${deporte.name}): se cierra <t:${unix}:R> (<t:${unix}:t>).\n` +
        (borrador ? `📝 Tienes un borrador a medias: ${borrador.hechos} de ${borrador.total} pronósticos.\n` : "") +
        "Envíala en /juegos → ⚽ Apuestas → 🧾 Quiniela."
    );
}

/** El borrador de una persona en una quiniela: cuántos pronósticos lleva (o null). */
function resumenBorrador(userId, quinielaId) {
    const fila = db
        .prepare("SELECT pronosticos FROM quiniela_borrador WHERE userId = ? AND quinielaId = ?")
        .get(String(userId), quinielaId);
    return fila ? { hechos: [...fila.pronosticos].filter((c) => c !== "-").length, total: fila.pronosticos.length } : null;
}

/** Avisa de las quinielas por cerrar a quien no las ha enviado. @returns {Promise<number>} DMs enviados */
async function enviarRecordatoriosQuiniela(client, ahora) {
    const horas = horasQuiniela(client);
    if (!horas) return 0;
    const marcar = db.prepare("INSERT OR IGNORE INTO quiniela_recordadas (quinielaId, userId, enviado_en) VALUES (?, ?, ?)");
    let enviados = 0;
    for (const q of quinielasPorCerrar(horas, ahora)) {
        for (const userId of aAvisarDeQuiniela(q.id)) {
            // Se marca antes de enviar: unos DM cerrados no se reintentan cada 5 minutos.
            if (marcar.run(q.id, userId, ahora).changes !== 1) continue;
            if (await enviarAviso(client, userId, "quiniela_recordatorio", { content: mensajeQuiniela(q, resumenBorrador(userId, q.id)) }))
                enviados++;
        }
    }
    if (enviados) log.info(`Recordatorio de quiniela: ${enviados} DMs`);
    return enviados;
}

/** Manda los recordatorios pendientes: de partidos y de quinielas sin enviar. @returns {Promise<number>} DMs enviados */
async function enviarRecordatorios(client, { ahora = Date.now() } = {}) {
    return (await enviarRecordatoriosPartidos(client, ahora)) + (await enviarRecordatoriosQuiniela(client, ahora));
}

module.exports = { quinielasPorCerrar, aAvisarDeQuiniela, enviarRecordatorios };
