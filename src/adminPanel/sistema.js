// Panel admin → 🩺 Sistema: el diagnóstico del bot (uptime, memoria, BD, logs, Gemini, Odds API y ajustes), el de
// TTCL, el nivel de log en caliente, las 🔔 alertas por DM a los admins (y la vista previa del 📊 resumen semanal) y 🤖
// probar el modelo de Gemini. Antes eran los comandos /diagnostico y /ttcl-diagnostico.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const repo = require("../repositorios/sistema");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { createLogger, getLogStats, setLogLevel } = require("../core/logger");
const latencias = require("../core/latencias");
const { getUsage: getGeminiUsage } = require("../services/geminiClient");
const { creditosRestantes, CREDITOS_AVISO } = require("../services/oddsApi");
const { handleExtrasButton, handleExtrasSelect } = require("./sistemaExtras");
const { buildAlertas, probarAlertas, alternarCategoria, abrirModalAlertas, handleAlertasModal } = require("./sistemaAlertas");

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
            new ButtonBuilder().setCustomId("paneladmin_sis_latencias").setLabel("⏱️ Latencias").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_sis_copias").setLabel("💾 Copias").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_sis_tareas").setLabel("🕒 Tareas").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_sis_msgs").setLabel("✉️ Mensajes").setStyle(ButtonStyle.Secondary),
        ),
    ];
}

function textoCreditos() {
    const c = creditosRestantes();
    if (c.restantes === null) return "sin consultar desde el arranque";
    return `**${c.restantes}** créditos restantes este mes (<t:${Math.floor(c.at / 1000)}:R>)${c.restantes < CREDITOS_AVISO ? " ⚠️" : ""}`;
}

// Comprueba que la base de datos responde y cuenta los usuarios del banco.
function estadoBaseDatos() {
    try {
        return { dbOk: "OK", dbUsers: repo.usuariosDelBanco() };
    } catch (e) {
        log.error("La base de datos no responde:", e);
        return { dbOk: `ERROR: ${e.message}`, dbUsers: 0 };
    }
}

function textoUltimoError(logs) {
    if (!logs.lastError) return "ninguno";
    const { at, scope, message } = logs.lastError;
    return `<t:${Math.floor(at / 1000)}:R> ${scope ? `[${scope}] ` : ""}${message}`.slice(0, 1000);
}

function camposServidor(client, dbOk, dbUsers, logs) {
    return [
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
        { name: "Último error", value: textoUltimoError(logs), inline: false },
    ];
}

// Gemini, Odds API y alertas: lo que depende de servicios externos.
function camposExternos(cfg) {
    const g = getGeminiUsage();
    const adminsAlerta = guildSettings.parseCsvIds(cfg.alertas.admin_ids);
    return [
        {
            name: "Gemini (desde el arranque)",
            value: `${g.llamadas} llamadas · ${g.errores} errores (${g.cuotaAgotada} por cuota) · tokens ${g.tokensEntrada.toLocaleString("es")} entrada / ${g.tokensSalida.toLocaleString("es")} salida`,
            inline: false,
        },
        { name: "Odds API", value: textoCreditos(), inline: false },
        {
            name: "🛠️ Mantenimiento",
            value: cfg.mantenimiento.activo ? "**ACTIVO**: solo los admins usan el bot" : "desactivado",
            inline: false,
        },
        {
            name: "Alertas por DM",
            value: cfg.alertas.enabled
                ? `activas · a ${adminsAlerta.length ? `${adminsAlerta.length} admins` : "el dueño del servidor"}`
                : "desactivadas",
            inline: false,
        },
    ];
}

// Ajustes de cada módulo tal cual están guardados.
function camposAjustes(cfg) {
    return [
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
    ];
}

function buildDiagnostico(client, guildId, aviso = "") {
    const cfg = guildSettings.getSettings(guildId);
    const { dbOk, dbUsers } = estadoBaseDatos();
    const logs = getLogStats();
    const embed = new EmbedBuilder()
        .setTitle("🩺 Diagnóstico del bot")
        .setDescription(aviso || null)
        .addFields(...camposServidor(client, dbOk, dbUsers, logs), ...camposExternos(cfg), ...camposAjustes(cfg))
        .setColor(dbOk === "OK" && logs.error === 0 ? 0x2ecc71 : dbOk === "OK" ? 0xf1c40f : 0xe74c3c)
        .setTimestamp();
    return { content: "", embeds: [embed], components: filas(logs.level) };
}

function buildTtcl(guildId) {
    const cripto = require("../systems/cripto/mercado");
    const circulacion = cripto.ttclCirculacion();
    const pool = cripto.leerPool();
    const ultimo = repo.ultimoPrecioTtcl();
    const totalPuntos = repo.puntosDePrecio();
    const puntos24h = repo.puntosDePrecioDesde(Date.now() - 24 * 3600 * 1000);
    const holders = repo.tenedoresDeTtcl();
    const totalTtcl = repo.ttclEnCarteras();
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

/** ⏱️ Latencias (#481): p50 y p95 de lo que tarda cada manejador (mensajes, botones y formularios, tareas). */
function buildLatencias() {
    const embed = new EmbedBuilder()
        .setTitle("⏱️ Latencias por manejador")
        .setDescription(
            `Los 15 más lentos (por p95), con las últimas ${latencias.MAX_MUESTRAS} muestras de cada uno desde el arranque. ` +
                "Todo en milisegundos. `mensaje:duende` incluye la espera a Gemini.\n```\n" +
                `${latencias.tabla(15)}\n` +
                "```",
        )
        .setColor(0x3498db)
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sis_latencias").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_sis_home").setLabel("◀ Sistema").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

async function probarGemini(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { comprobarModelo, modeloDe, textoComprobacion } = require("../services/duende/gemini");
    const r = await comprobarModelo(modeloDe(interaction.guildId));
    log.info(`Comprobación del modelo de Gemini por ${interaction.user.tag}: ${r.ok ? "ok" : r.motivo}`);
    await interaction.editReply({ content: textoComprobacion(r) });
    return true;
}

// Genera una frase con Gemini TTS (los mismos modelos y respaldos que /tts y el Duende) y la adjunta para oírla aquí.
async function probarVoz(interaction) {
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

async function handleSistemaButton(interaction) {
    const id = interaction.customId;
    if (await handleExtrasButton(interaction)) return true;
    const categoria = /^paneladmin_sis_alertas_tipo_(\w+)$/.exec(id)?.[1];
    if (categoria) return alternarCategoria(interaction, categoria);
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
    if (id === "paneladmin_sis_latencias") {
        await interaction.update(buildLatencias());
        return true;
    }
    if (id === "paneladmin_sis_alertas_editar") return abrirModalAlertas(interaction);
    if (id === "paneladmin_sis_alertas_probar") return probarAlertas(interaction);
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
    if (id === "paneladmin_sis_gemini") return probarGemini(interaction);
    if (id === "paneladmin_sis_voz") return probarVoz(interaction);
    return false;
}

// Nivel de log en caliente (vuelve al de .env al reiniciar).
async function handleSistemaSelect(interaction) {
    if (await handleExtrasSelect(interaction)) return true;
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

async function handleSistemaModal(interaction) {
    return interaction.customId === "paneladmin_sis_alertas_modal" ? handleAlertasModal(interaction) : false;
}

module.exports = { handleSistemaButton, handleSistemaSelect, handleSistemaModal };
