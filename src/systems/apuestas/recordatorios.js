// Recordatorio por DM antes de un partido al que se ha apostado (cron cada 5 min en index.js). Cada apuesta se
// recuerda una sola vez (apuestas_usuario.recordado); quien tenga varias en partidos que empiezan pronto recibe
// un único mensaje con todas. Se configura en /paneladmin → ⚽ Apuestas (apuestas.recordatorio y _min).
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { sendDm } = require("../xp/rachas");
const { DEPORTES } = require("../../services/oddsApi");
const { marcadorDe } = require("./marcador");
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

/** Manda los recordatorios pendientes. @returns {Promise<number>} DMs enviados */
async function enviarRecordatorios(client, { ahora = Date.now() } = {}) {
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
        if (await sendDm(client, userId, { content: mensaje(suyas, cfg.minutos) })) enviados++;
    }
    log.info(`Recordatorio de partidos: ${enviados}/${porUsuario.size} DMs (${apuestas.length} apuestas)`);
    return enviados;
}

module.exports = { enviarRecordatorios, pendientesDeRecordar };
