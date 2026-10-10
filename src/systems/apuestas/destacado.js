// ⭐ Partido destacado del día (F-AP-07): cada día, desde las 10:00 (hora de Madrid), se publica en el canal de resultados
// de las apuestas el partido grande de la jornada con sus cuotas y los botones para apostar. Sale de los partidos ya
// guardados (apuestas_partidos, que se rellena al consultar las cuotas): no gasta créditos de la Odds API.
//
// "Partido grande": de los de hoy que aún no han empezado, el que más apuestas tiene ya; a igualdad, el más igualado
// (cuotas de local y visitante más parecidas, que suele ser un partido entre dos buenos equipos) y, si no, el primero.
// Cron cada hora de 10 a 20 y al arrancar: se publica una vez al día por servidor (apuestas.destacado_dia), aunque el
// bot se reinicie. Se activa o desactiva en /paneladmin → ⚽ Apuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { DEPORTES } = require("../../services/oddsApi");
const marcadorExacto = require("./marcador");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

/** Desde esta hora (Madrid) se publica. */
const HORA = 10;

const { momentoMadrid: momento } = require("../../core/zonaMadrid");

/** El partido destacado de hoy (con `apuestas`, cuántas tiene ya), o null si hoy no queda ninguno con cuotas. */
function elegir(ahora = Date.now()) {
    const { dia } = momento(ahora);
    // Los próximos dos días en SQL (las horas son texto ISO en UTC) y el día exacto, en hora de Madrid.
    const candidatos = db
        .prepare(
            `SELECT p.*, (SELECT COUNT(*) FROM apuestas_usuario a WHERE a.match_id = p.match_id) AS apuestas
             FROM apuestas_partidos p
             WHERE p.estado = 'abierto' AND p.start_time > ? AND p.start_time < ?
               AND p.cuota_home IS NOT NULL AND p.cuota_draw IS NOT NULL AND p.cuota_away IS NOT NULL`,
        )
        .all(new Date(ahora).toISOString(), new Date(ahora + 2 * 86400 * 1000).toISOString())
        .filter((p) => momento(p.start_time).dia === dia);
    const igualdad = (p) => Math.abs(p.cuota_home - p.cuota_away);
    candidatos.sort(
        (a, b) => b.apuestas - a.apuestas || igualdad(a) - igualdad(b) || a.start_time.localeCompare(b.start_time) || a.id - b.id,
    );
    return candidatos[0] || null;
}

/**
 * El mensaje: el partido con sus cuotas y los mismos botones de apostar que el detalle del partido en /juegos (abren el
 * formulario de cada uno; si el partido ya ha empezado, el formulario lo rechaza).
 */
function mensaje(partido) {
    const unix = Math.floor(Date.parse(partido.start_time) / 1000);
    const comp = DEPORTES[partido.deporte] || DEPORTES.laliga;
    const apuestas = partido.apuestas
        ? `\n\n🔥 Ya hay **${partido.apuestas}** ${partido.apuestas === 1 ? "apuesta" : "apuestas"} a este partido`
        : "";
    const embed = new EmbedBuilder()
        .setTitle("⭐ Partido destacado del día")
        .setDescription(
            `${comp.emoji} **${partido.home_team}** vs **${partido.away_team}** · ${comp.name}\n` +
                `🕘 <t:${unix}:t> (<t:${unix}:R>)\n\n` +
                `🏠 **${partido.home_team}**: cuota \`${partido.cuota_home}\`\n` +
                `🤝 **Empate**: cuota \`${partido.cuota_draw}\`\n` +
                `🚩 **${partido.away_team}**: cuota \`${partido.cuota_away}\`` +
                apuestas,
        )
        .setFooter({ text: "Pulsa un resultado para apostar · Más partidos en /juegos → ⚽ Apuestas" })
        .setColor(0xf1c40f);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`apuesta_home_${partido.match_id}`)
            .setLabel(`🏠 ${partido.home_team}`.slice(0, 80))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`apuesta_draw_${partido.match_id}`).setLabel("🤝 Empate").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`apuesta_away_${partido.match_id}`)
            .setLabel(`🚩 ${partido.away_team}`.slice(0, 80))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`apuesta_exacto_${partido.match_id}`)
            .setLabel(`🎯 Marcador exacto (×${marcadorExacto.PREMIO})`)
            .setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila] };
}

/**
 * Cron y arranque: en cada servidor con el destacado activo y canal de resultados, si son las 10:00 o más y hoy no se ha
 * publicado, publica el de hoy. @returns {Promise<number>} servidores en los que se ha publicado
 */
async function publicarSiToca(client, ahora = Date.now()) {
    const { dia, hora } = momento(ahora);
    if (hora < HORA) return 0;
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const cfg = guildSettings.getSettings(guild.id).apuestas;
        if (!cfg.destacado || !cfg.canal_resultados || cfg.destacado_dia === dia) continue;
        const partido = elegir(ahora);
        if (!partido) {
            log.debug(`Partido destacado: hoy no queda ningún partido con cuotas (${guild.name})`);
            continue;
        }
        try {
            const canal =
                guild.channels.cache.get(cfg.canal_resultados) || (await guild.channels.fetch(cfg.canal_resultados).catch(() => null));
            if (!canal?.isTextBased?.()) {
                log.warn(`Partido destacado: el canal de resultados ${cfg.canal_resultados} de ${guild.name} no existe o no es de texto`);
                continue;
            }
            await canal.send(mensaje(partido));
            guildSettings.setSetting(guild.id, "apuestas.destacado_dia", dia);
            publicados++;
            log.info(
                `Partido destacado del ${dia} en ${guild.name}: ${partido.home_team} vs ${partido.away_team} (${partido.apuestas} apuestas)`,
            );
        } catch (e) {
            log.warn(`No se pudo publicar el partido destacado en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

module.exports = { HORA, momento, elegir, mensaje, publicarSiToca };
