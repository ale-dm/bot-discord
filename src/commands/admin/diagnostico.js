const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require("discord.js");
const db = require("../../core/db");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { createLogger, getLogStats, setLogLevel } = require("../../core/logger");
const { getUsage: getGeminiUsage } = require("../../services/geminiClient");

const log = createLogger("Diagnóstico");

function fmtMs(ms) {
    const sec = Math.floor(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("diagnostico")
        .setDescription("Estado interno del bot y servicios")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((opt) =>
            opt
                .setName("nivel_log")
                .setDescription("Cambia el nivel de log en caliente (vuelve al de .env al reiniciar)")
                .addChoices(
                    { name: "debug (todo, muy detallado)", value: "debug" },
                    { name: "info (normal)", value: "info" },
                    { name: "warn (solo avisos y errores)", value: "warn" },
                    { name: "error (solo errores)", value: "error" },
                ),
        ),

    async run(client, interaction) {
        const guildId = interaction.guildId;
        const cfg = guildSettings.getSettings(guildId);

        const nuevoNivel = interaction.options.getString("nivel_log");
        let cambioNivel = "";
        if (nuevoNivel) {
            const anterior = getLogStats().level;
            setLogLevel(nuevoNivel);
            log.warn(`Nivel de log cambiado de ${anterior} a ${nuevoNivel} por ${interaction.user.tag}`);
            adminAudit.logAdminAction({
                guildId,
                actorId: interaction.user.id,
                action: "logs.level",
                details: { anterior, nuevo: nuevoNivel },
            });
            cambioNivel = ` (antes ${anterior})`;
        }

        let dbOk = "OK";
        let dbUsers = 0;
        try {
            dbUsers = db.prepare("SELECT COUNT(*) as total FROM banco").get()?.total || 0;
            db.prepare("SELECT 1 as ok").get();
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

        const memMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
        const embed = new EmbedBuilder()
            .setTitle("🩺 Diagnóstico del Bot")
            .addFields(
                { name: "Uptime", value: fmtMs(process.uptime() * 1000), inline: true },
                { name: "Memoria RSS", value: `${memMb} MB`, inline: true },
                { name: "Comandos cargados", value: String(client.slashCommands?.size || 0), inline: true },
                { name: "DB", value: dbOk, inline: true },
                { name: "Usuarios banco", value: String(dbUsers), inline: true },
                { name: "Guilds conectadas", value: String(client.guilds.cache.size), inline: true },
                {
                    name: "Logs",
                    value: `nivel=**${logs.level}**${cambioNivel} · consola=${logs.consoleLevel} · desde el arranque: ${logs.error} errores, ${logs.warn} avisos`,
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

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
