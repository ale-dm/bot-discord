// Panel admin → 🩺 Sistema: el diagnóstico del bot (uptime, memoria, BD, logs, Gemini y ajustes), el de TTCL y el
// nivel de log en caliente. Antes eran los comandos /diagnostico y /ttcl-diagnostico.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const db = require("../core/db");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { createLogger, getLogStats, setLogLevel } = require("../core/logger");
const { getUsage: getGeminiUsage } = require("../services/geminiClient");

const log = createLogger("Diagnóstico");

function fmtMs(ms) {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
}

function filas(nivelActual) {
    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("paneladmin_sis_log")
                .setPlaceholder(`Nivel de log: ${nivelActual}`)
                .addOptions(
                    { label: "debug (todo, muy detallado)", value: "debug", default: nivelActual === "debug" },
                    { label: "info (normal)", value: "info", default: nivelActual === "info" },
                    { label: "warn (solo avisos y errores)", value: "warn", default: nivelActual === "warn" },
                    { label: "error (solo errores)", value: "error", default: nivelActual === "error" },
                ),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_sis_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_sis_ttcl").setLabel("💎 TTCL").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
        ),
    ];
}

function buildDiagnostico(client, guildId, aviso = "") {
    const cfg = guildSettings.getSettings(guildId);
    let dbOk = "OK";
    let dbUsers = 0;
    try {
        dbUsers = db.prepare("SELECT COUNT(*) as total FROM banco").get()?.total || 0;
    } catch (e) {
        dbOk = `ERROR: ${e.message}`;
        log.error("La base de datos no responde:", e);
    }
    const logs = getLogStats();
    const ultimoError = logs.lastError
        ? `<t:${Math.floor(logs.lastError.at / 1000)}:R> ${logs.lastError.scope ? `[${logs.lastError.scope}] ` : ""}${logs.lastError.message}`.slice(
              0,
              1000,
          )
        : "ninguno";
    const g = getGeminiUsage();
    const embed = new EmbedBuilder()
        .setTitle("🩺 Diagnóstico del bot")
        .setDescription(aviso || null)
        .addFields(
            { name: "Uptime", value: fmtMs(process.uptime() * 1000), inline: true },
            { name: "Memoria RSS", value: `${(process.memoryUsage().rss / (1024 * 1024)).toFixed(1)} MB`, inline: true },
            { name: "Comandos cargados", value: String(client.slashCommands?.size || 0), inline: true },
            { name: "DB", value: dbOk, inline: true },
            { name: "Usuarios banco", value: String(dbUsers), inline: true },
            { name: "Guilds conectadas", value: String(client.guilds?.cache?.size || 0), inline: true },
            {
                name: "Logs",
                value: `nivel=**${logs.level}** · consola=${logs.consoleLevel} · desde el arranque: ${logs.error} errores, ${logs.warn} avisos`,
                inline: false,
            },
            { name: "Último error", value: ultimoError, inline: false },
            {
                name: "Gemini (desde el arranque)",
                value: `${g.llamadas} llamadas · ${g.errores} errores (${g.cuotaAgotada} por cuota) · tokens ${g.tokensEntrada.toLocaleString("es")} entrada / ${g.tokensSalida.toLocaleString("es")} salida`,
                inline: false,
            },
            {
                name: "Duende",
                value: `modelo=${cfg.duende.model || "default"} · canal=${cfg.duende.allowed_channel_id || "*"}`,
                inline: false,
            },
            {
                name: "Cripto",
                value: `buyCD=${cfg.cripto.cooldown_buy_sec}s · sellCD=${cfg.cripto.cooldown_sell_sec}s · fee=${cfg.cripto.fee_buy_pct}/${cfg.cripto.fee_sell_pct}%`,
                inline: false,
            },
            {
                name: "Tienda",
                value: `enabled=${cfg.tienda.enabled ? "1" : "0"} · cd=${cfg.tienda.buy_cooldown_sec}s · daily=${cfg.tienda.daily_limit || "∞"}`,
                inline: false,
            },
            {
                name: "Logros",
                value: `enabled=${cfg.logros?.enabled ? "1" : "0"} · mult=x${cfg.logros?.reward_multiplier || 1} · off=${cfg.logros?.disabled_categories || "none"}`,
                inline: false,
            },
        )
        .setColor(dbOk === "OK" && logs.error === 0 ? 0x2ecc71 : dbOk === "OK" ? 0xf1c40f : 0xe74c3c)
        .setTimestamp();
    return { content: "", embeds: [embed], components: filas(logs.level) };
}

function buildTtcl(guildId) {
    const cripto = require("../systems/cripto/mercado");
    const circulacion = db.prepare("SELECT circulacion FROM cripto_ttcl WHERE id = 1").get()?.circulacion || 0;
    const ultimo = db.prepare("SELECT precio, timestamp FROM cripto_ttcl_precios ORDER BY timestamp DESC LIMIT 1").get();
    const totalPuntos = db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios").get()?.total || 0;
    const puntos24h =
        db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios WHERE timestamp >= ?").get(Date.now() - 24 * 3600 * 1000)?.total || 0;
    const holders =
        db.prepare("SELECT COUNT(DISTINCT userId) as total FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0").get()?.total || 0;
    const totalTtcl = db.prepare("SELECT COALESCE(SUM(cantidad), 0) as total FROM cripto_carteras WHERE cripto = 'TTCL'").get()?.total || 0;
    const embed = new EmbedBuilder()
        .setTitle("💎 Diagnóstico TTCL")
        .setColor(0x9b59b6)
        .addFields(
            { name: "💰 Precio actual", value: `${Number(cripto.getTtclPrecio(guildId)).toFixed(2)} monedas`, inline: true },
            { name: "🔄 Circulación", value: `${Number(circulacion).toFixed(2)} / 1M`, inline: true },
            { name: "📊 Puntos gráfica", value: `${totalPuntos} registros (${puntos24h} en 24h)`, inline: true },
            { name: "⏱️ Último registro", value: ultimo ? `<t:${Math.floor(ultimo.timestamp / 1000)}:R>` : "Sin registros", inline: true },
            { name: "👥 Holders", value: `${holders} usuarios con TTCL`, inline: true },
            { name: "💎 TTCL en carteras", value: `${Number(totalTtcl).toFixed(2)} total`, inline: true },
            { name: "⏰ Próxima actualización", value: "Cada 10 minutos automáticas", inline: false },
        )
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sis_home").setLabel("◀ Sistema").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

async function handleSistemaButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_sis_home") {
        await interaction.update(buildDiagnostico(interaction.client, interaction.guildId));
        return true;
    }
    if (id === "paneladmin_sis_ttcl") {
        await interaction.update(buildTtcl(interaction.guildId));
        return true;
    }
    return false;
}

// Nivel de log en caliente (vuelve al de .env al reiniciar).
async function handleSistemaSelect(interaction) {
    if (interaction.customId !== "paneladmin_sis_log") return false;
    const nuevo = interaction.values[0];
    const anterior = getLogStats().level;
    setLogLevel(nuevo);
    log.warn(`Nivel de log cambiado de ${anterior} a ${nuevo} por ${interaction.user.tag}`);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "logs.level",
        details: { anterior, nuevo },
    });
    await interaction.update(
        buildDiagnostico(
            interaction.client,
            interaction.guildId,
            `✅ Nivel de log: **${nuevo}** (antes ${anterior}). Vuelve al de .env al reiniciar.`,
        ),
    );
    return true;
}

module.exports = { buildDiagnostico, buildTtcl, handleSistemaButton, handleSistemaSelect };
