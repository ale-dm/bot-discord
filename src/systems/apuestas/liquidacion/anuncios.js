// Lo que se dice al cerrar: el DM a quien cobra, el resumen público y el embed de resultados.

const { EmbedBuilder } = require("discord.js");
const { logWarn, logDebug } = require("../../../core/logger");
const { DEPORTES } = require("../../../services/oddsApi");
const { fmtNumero } = require("../../../core/formato");

// Avisa por DM a quien haya cobrado algo. Best-effort: si tiene los DMs cerrados, se ignora.
async function avisarGanadores(client, pagos) {
    for (const p of pagos) {
        try {
            const user = await client.users.fetch(p.userId);
            await user.send(
                p.reembolso
                    ? `↩️ Te he devuelto **${p.premio.toLocaleString("es")}** monedas: ${p.descripcion.replace(/^Reembolso: /, "")}.`
                    : `🏆 ¡Has ganado **${p.premio.toLocaleString("es")}** monedas con tu apuesta (${p.descripcion})!`,
            );
        } catch (e) {
            (e.code === 50007 ? logDebug : logWarn)(`[PAGARAPUESTAS] No se pudo avisar por DM a ${p.userId}: ${e.message}`);
        }
    }
}

// Menciones sin repetir y sin avisar (el mensaje se manda con allowedMentions vacío): se ve quién, sin ping.
const menciones = (ids, max = 10) => {
    const unicos = [...new Set(ids)];
    return (
        unicos
            .slice(0, max)
            .map((id) => `<@${id}>`)
            .join(", ") + (unicos.length > max ? ` y ${unicos.length - max} más` : "")
    );
};

/** Embed con los partidos y quinielas cerrados en una liquidación, o null si no se cerró nada. */
function resultadosEmbed(resumen) {
    const lineas = [];
    for (const p of resumen.partidos || []) {
        const comp = DEPORTES[p.deporte]?.name || p.deporte;
        const acertantes = new Set(p.ganadores).size;
        const detalle = p.ganadores.length
            ? `✅ ${acertantes} de ${p.apostantes} acertaron · **${fmtNumero(p.repartido)}** 🪙 en premios · 🏆 ${menciones(p.ganadores)}`
            : `❌ Nadie acertó (${p.apostantes} ${p.apostantes === 1 ? "apuesta" : "apuestas"})`;
        lineas.push(`⚽ **${p.home} ${p.marcador} ${p.away}** · ${comp}\n${detalle}`);
    }
    for (const q of resumen.quinielas || []) {
        const comp = DEPORTES[q.deporte]?.name || q.deporte;
        const detalle = q.ganadores.length
            ? `🏆 ${q.ganadores.length} ${q.ganadores.length === 1 ? "ganador" : "ganadores"} con ${q.maxAciertos}/${q.partidos} aciertos · **${fmtNumero(q.premioUnitario)}** 🪙 cada uno · ${menciones(q.ganadores)}`
            : `↩️ Nadie llegó a ${q.minimo} aciertos (máximo ${q.maxAciertos}): se devuelve lo apostado a ${q.jugadores} ${q.jugadores === 1 ? "jugador" : "jugadores"}`;
        lineas.push(`🧾 **Quiniela ${q.jornada}** · ${comp}\n${detalle}`);
    }
    // Con persona(): el Duende (F-DU-03) sale por su nombre, no es un usuario de Discord.
    const { persona } = require("../../../paneles/retos");
    for (const r of resumen.retos || []) {
        lineas.push(
            `⚔️ **Reto** ${persona(r.creador)} vs ${persona(r.rival)} · ${r.partido}\n🏆 Gana ${persona(r.ganador)} y se lleva **${fmtNumero(r.premio)}** 🪙`,
        );
    }
    if (!lineas.length) return null;
    let descripcion = "";
    for (const l of lineas) {
        if (descripcion.length + l.length + 2 > 4000) {
            descripcion += "\n…";
            break;
        }
        descripcion += (descripcion ? "\n\n" : "") + l;
    }
    return new EmbedBuilder()
        .setTitle("📢 Resultados de las apuestas")
        .setDescription(descripcion)
        .setFooter({ text: "Tus jugadas, en /juegos → 📋 Mis jugadas" })
        .setColor(0x27ae60)
        .setTimestamp();
}

/**
 * Publica los resultados de una liquidación en el canal de resultados de cada servidor que lo tenga configurado
 * (/paneladmin → ⚽ Apuestas). Best-effort: un canal que no existe o sin permisos se registra y se sigue.
 * @returns {Promise<number>} canales en los que se ha publicado
 */
async function anunciarResultados(client, resumen) {
    const embed = resultadosEmbed(resumen);
    if (!embed) return 0;
    const guildSettings = require("../../guildSettings");
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const canalId = guildSettings.getSettings(guild.id).apuestas.canal_resultados;
        if (!canalId) continue;
        try {
            const canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId).catch(() => null));
            if (!canal?.isTextBased?.()) {
                logWarn(`[PAGARAPUESTAS] El canal de resultados ${canalId} de ${guild.name} no existe o no es de texto`);
                continue;
            }
            await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
            publicados++;
        } catch (e) {
            logWarn(`[PAGARAPUESTAS] No se pudieron publicar los resultados en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

/** Resumen de una liquidación para enseñarlo (panel de admin → ⚽ Apuestas → 💸 Liquidar ahora). */
function resumenEmbed(resumen) {
    let descripcionDeportes = "";
    for (const [deporte, cantidad] of Object.entries(resumen.partidosProcesados)) {
        const deporteInfo = DEPORTES[deporte];
        if (deporteInfo && cantidad > 0) descripcionDeportes += `• ${deporteInfo.name}: **${cantidad}** partidos\n`;
    }
    const retosCerrados = resumen.retosCerrados?.length || 0;
    const nada = resumen.total === 0 && resumen.quinielasCerradas === 0 && resumen.caducados === 0 && !retosCerrados;
    return new EmbedBuilder()
        .setTitle("💸 Pago de apuestas deportivas")
        .setDescription(
            `🏆 **Apuestas ganadoras:** ${resumen.pagadas}\n` +
                `❌ **Apuestas perdedoras:** ${resumen.fallidas}\n` +
                `📊 **Total procesadas:** ${resumen.total}\n` +
                `🗓️ **Partidos finalizados:** ${Object.values(resumen.partidosProcesados).reduce((a, b) => a + b, 0)}\n\n` +
                `🧾 **Quinielas cerradas:** ${resumen.quinielasCerradas}\n` +
                `🎁 **Premios quiniela repartidos:** ${resumen.premiosQuiniela}\n` +
                (retosCerrados ? `⚔️ **Retos a partidos cerrados:** ${retosCerrados}\n` : "") +
                (resumen.caducados
                    ? `↩️ **Sin resultado (más de 3 días):** ${resumen.caducados} · **apuestas reembolsadas:** ${resumen.reembolsos}\n`
                    : "") +
                "\n" +
                (descripcionDeportes ? `**Deportes procesados:**\n${descripcionDeportes}\n` : "") +
                (nada ? "📋 No había apuestas pendientes de pago." : "✅ Procesamiento completado."),
        )
        .setColor(resumen.total > 0 ? 0x27ae60 : 0x2980b9)
        .setTimestamp();
}

module.exports = { avisarGanadores, menciones, resultadosEmbed, anunciarResultados, resumenEmbed };
