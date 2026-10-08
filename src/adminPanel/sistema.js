// Panel admin → 🩺 Sistema: el diagnóstico del bot (uptime, memoria, BD, logs, Gemini, Odds API y ajustes), el de
// TTCL, el nivel de log en caliente, las 🔔 alertas por DM a los admins (y la vista previa del 📊 resumen semanal) y 🤖
// probar el modelo de Gemini. Antes eran los comandos /diagnostico y /ttcl-diagnostico.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const db = require("../core/db");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const alertas = require("../systems/alertas");
const { createLogger, getLogStats, setLogLevel } = require("../core/logger");
const { getUsage: getGeminiUsage } = require("../services/geminiClient");
const { creditosRestantes, CREDITOS_AVISO } = require("../services/oddsApi");
const { simpleModal } = require("./common");

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
            new ButtonBuilder().setCustomId("paneladmin_sis_alertas").setLabel("🔔 Alertas").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_sis_gemini").setLabel("🤖 Probar Gemini").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_sis_voz").setLabel("🔊 Probar voz").setStyle(ButtonStyle.Secondary),
        ),
    ];
}

function textoCreditos() {
    const c = creditosRestantes();
    if (c.restantes === null) return "sin consultar desde el arranque";
    return `**${c.restantes}** créditos restantes este mes (<t:${Math.floor(c.at / 1000)}:R>)${c.restantes < CREDITOS_AVISO ? " ⚠️" : ""}`;
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
    const adminsAlerta = guildSettings.parseCsvIds(cfg.alertas.admin_ids);
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
            { name: "Odds API", value: textoCreditos(), inline: false },
            {
                name: "Alertas por DM",
                value: cfg.alertas.enabled
                    ? `activas · a ${adminsAlerta.length ? `${adminsAlerta.length} admins` : "el dueño del servidor"}`
                    : "desactivadas",
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
    const circulacion = cripto.ttclCirculacion();
    const pool = cripto.leerPool();
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
            { name: "💰 Precio actual", value: `${Number(cripto.getTtclPrecio()).toFixed(2)} monedas`, inline: true },
            { name: "🔄 En carteras", value: `${Number(circulacion).toFixed(2)} TTCL`, inline: true },
            {
                name: "💧 Pool",
                value: `${Math.round(pool.monedas).toLocaleString("es")} monedas · ${pool.ttcl.toFixed(2)} TTCL`,
                inline: true,
            },
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

function buildAlertas(guild, aviso = "") {
    const e = alertas.estado(guild?.id);
    const quien = e.adminIds.length
        ? e.adminIds.map((id) => `<@${id}>`).join(", ")
        : `el dueño del servidor${guild?.ownerId ? ` (<@${guild.ownerId}>)` : ""}`;
    const ultimas = e.historial.length
        ? e.historial.map((h) => `<t:${Math.floor(h.at / 1000)}:R> ${h.titulo} → ${h.enviadas}/${h.destinatarios}`).join("\n")
        : "Ninguna desde el arranque.";
    const embed = new EmbedBuilder()
        .setTitle("🔔 Alertas por DM")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Avisan por mensaje privado de: errores nuevos del bot (el mismo error, como mucho una vez cada 6 h), " +
                `Odds API con menos de ${CREDITOS_AVISO} créditos, Gemini sin cuota, un modelo de Gemini que no funciona al ` +
                `arrancar y copias de seguridad que fallan. Como mucho ${alertas.MAX_POR_HORA} a la hora.

` +
                "Además, cada lunes a las 09:00, un 📊 resumen de la semana (errores, comandos más usados, Gemini y Odds API).",
        )
        .addFields(
            { name: "Estado", value: e.activas ? "Activas" : "Desactivadas", inline: true },
            { name: "A quién", value: quien.slice(0, 1024), inline: true },
            { name: "Últimas enviadas", value: ultimas.slice(0, 1024), inline: false },
        )
        .setColor(e.activas ? 0x2ecc71 : 0x95a5a6)
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sis_alertas_editar").setLabel("✏️ Configurar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_sis_alertas_probar").setLabel("📨 Probar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_sis_resumen").setLabel("📊 Resumen semanal").setStyle(ButtonStyle.Secondary),
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
    if (id === "paneladmin_sis_alertas") {
        await interaction.update(buildAlertas(interaction.guild));
        return true;
    }
    if (id === "paneladmin_sis_alertas_editar") {
        const cfg = guildSettings.getSettings(interaction.guildId).alertas;
        await interaction.showModal(
            simpleModal("paneladmin_sis_alertas_modal", "Alertas por DM", [
                { id: "activas", label: "Activas (1/0)", value: cfg.enabled ? "1" : "0" },
                {
                    id: "ids",
                    label: "IDs de Discord, separados por comas",
                    required: false,
                    placeholder: "Vacío = el dueño del servidor",
                    value: cfg.admin_ids || "",
                },
            ]),
        );
        return true;
    }
    if (id === "paneladmin_sis_alertas_probar") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const enviadas = await alertas.probar(interaction.user.username);
        const total = alertas.destinatarios().length;
        await interaction.editReply({
            content: total
                ? `📨 Alerta de prueba enviada a ${enviadas} de ${total}.${enviadas < total ? " Quien no la recibe tiene los DMs cerrados para el bot." : ""}`
                : "❌ No hay a quién enviarla: las alertas están desactivadas.",
        });
        return true;
    }
    // 📊 Vista previa del resumen semanal (F-AD-02): lo que llegaría ahora, solo a quien pulsa (no cuenta como enviado).
    if (id === "paneladmin_sis_resumen") {
        const { construir } = require("../systems/resumenAdmin");
        await interaction.reply({
            content: "📊 Así va el resumen de esta semana (llega por DM los lunes a las 09:00 a quien recibe las alertas):",
            embeds: [construir()],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (id === "paneladmin_sis_gemini") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { comprobarModelo, modeloDe, textoComprobacion } = require("../services/duende/gemini");
        const r = await comprobarModelo(modeloDe(interaction.guildId));
        log.info(`Comprobación del modelo de Gemini por ${interaction.user.tag}: ${r.ok ? "ok" : r.motivo}`);
        await interaction.editReply({ content: textoComprobacion(r) });
        return true;
    }
    // Genera una frase con Gemini TTS (los mismos modelos y respaldos que /tts y el Duende) y la adjunta para oírla aquí.
    if (id === "paneladmin_sis_voz") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tts = require("../services/geminiTts");
        const t0 = Date.now();
        const tardo = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
        try {
            const wav = await tts.synthesizeSpeech("Hola, soy el Duende. Si me oyes, la voz funciona.");
            const segundos = (wav.length - 44) / (wav.readUInt32LE(24) * 2);
            log.info(`Prueba de voz por ${interaction.user.tag}: ok con ${tts.modeloActual()} (${tardo()})`);
            await interaction.editReply({
                content: `✅ Voz generada con **${tts.modeloActual()}** en ${tardo()} (${segundos.toFixed(1)} s de audio). Escúchala aquí; en un canal de voz, con \`/tts\`.`,
                files: [{ attachment: wav, name: "prueba-voz.wav" }],
            });
        } catch (e) {
            log.warn(`Prueba de voz por ${interaction.user.tag}: ${e.message}`);
            await interaction.editReply({ content: `❌ No se pudo generar la voz (${tardo()}):\n${e.message.slice(0, 1800)}` });
        }
        return true;
    }
    return false;
}

async function handleSistemaModal(interaction) {
    if (interaction.customId !== "paneladmin_sis_alertas_modal") return false;
    const activas = interaction.fields.getTextInputValue("activas").trim();
    const ids = guildSettings.parseCsvIds(interaction.fields.getTextInputValue("ids"));
    const malos = ids.filter((id) => !/^\d{17,20}$/.test(id));
    if (malos.length) {
        await interaction.reply({
            content: `❌ Esto no son IDs de Discord: ${malos.join(", ").slice(0, 200)}. (Clic derecho en la persona → Copiar ID de usuario.)`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guildSettings.setManySettings(interaction.guildId, { "alertas.enabled": activas, "alertas.admin_ids": ids.join(",") });
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "alertas.config",
        details: { activas, ids },
    });
    const payload = buildAlertas(interaction.guild, "✅ Alertas actualizadas.");
    if (interaction.isFromMessage?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
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

module.exports = { buildDiagnostico, buildTtcl, buildAlertas, handleSistemaButton, handleSistemaSelect, handleSistemaModal };
