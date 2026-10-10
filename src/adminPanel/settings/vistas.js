const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const guildSettings = require("../../systems/guildSettings");
const impuestos = require("../../systems/impuestos");
const { fmtNumero } = require("../../core/formato");

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

// Campos de Config Global de los módulos de siempre: Duende, Cripto, Casino, Tienda, ACL y Logros.
function camposModulos(cfg, acl) {
    return [
        {
            name: "🤖 Duende IA",
            value: `Modelo: **${cfg.duende.model || "default"}**\nTemp: **${cfg.duende.temperature}**`,
            inline: true,
        },
        {
            name: "📈 Cripto",
            value: `Fee buy/sell: **${cfg.cripto.fee_buy_pct}% / ${cfg.cripto.fee_sell_pct}%**`,
            inline: true,
        },
        {
            name: "🎰 Casino",
            value: `Apuesta: **${cfg.casino.min_bet} - ${cfg.casino.max_bet}**\nCooldown: **${cfg.casino.global_cooldown_sec}s**\nLímite diario: **${cfg.casino.daily_limit || "∞"}**`,
            inline: true,
        },
        {
            name: "🛒 Tienda",
            value: `Estado: **${cfg.tienda.enabled ? "Activa" : "Desactivada"}**\nCooldown compra: **${cfg.tienda.buy_cooldown_sec}s**\nLímite diario: **${cfg.tienda.daily_limit || "∞"}**`,
            inline: true,
        },
        { name: "🔐 ACL comandos", value: `Reglas activas: **${acl.length}**`, inline: true },
        {
            name: "🏅 Logros",
            value: `Estado: **${cfg.logros.enabled ? "Activo" : "Off"}**\nMultiplicador: **x${cfg.logros.reward_multiplier}**`,
            inline: true,
        },
    ];
}

// Campos de Config Global de la recompensa diaria, la clasificación, los eventos y los impuestos.
function camposAvanzados(cfg, guildId) {
    return [
        {
            name: "🎁 Diario",
            value: cfg.diario.enabled
                ? `**${cfg.diario.base}** + **${cfg.diario.por_dia_racha}**/día de racha\nTope: **${cfg.diario.tope}**`
                : "Desactivado",
            inline: true,
        },
        {
            name: "🏆 Clasificación semanal",
            value: cfg.clasificacion.canal
                ? `Lunes en <#${cfg.clasificacion.canal}>\nPremio: **${fmtNumero(cfg.clasificacion.premio)}**`
                : "Sin canal (no se publica)",
            inline: true,
        },
        {
            name: "🎉 Eventos",
            value:
                [cfg.eventos.xp.activo && `⚡ XP ×${cfg.eventos.xp.mult}`, cfg.eventos.casino.activo && `🎰 ${cfg.eventos.casino.pct} %`]
                    .filter(Boolean)
                    .join("\n") || "Ninguno activo",
            inline: true,
        },
        {
            name: "🏛️ Impuestos",
            value: `Reglas activas: **${impuestos.listarReglas(guildId).filter((r) => r.activo).length}**\nBote: **${fmtNumero(impuestos.boteTotal(guildId))}**`,
            inline: true,
        },
    ];
}

function filasConfigHome() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende").setLabel("🤖 Duende").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_cripto").setLabel("📈 Cripto").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_casino").setLabel("🎰 Casino").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_tienda").setLabel("🛒 Tienda").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_acl").setLabel("🔐 Comandos").setStyle(ButtonStyle.Danger),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_logros").setLabel("🏅 Logros").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_diario").setLabel("🎁 Diario").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_impuestos_home").setLabel("🏛️ Impuestos").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_semanal_home").setLabel("🏆 Semanal").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_eventos").setLabel("🎉 Eventos").setStyle(ButtonStyle.Success),
    );
    return [row1, row2];
}

function buildConfigHome(guildId) {
    const cfg = guildSettings.getSettings(guildId);
    const acl = guildSettings.listCommandAcl(guildId);
    const embed = new EmbedBuilder()
        .setTitle("⚙️ Configuración Global")
        .setDescription(
            "Administra parámetros de Duende, Cripto, Casino, Tienda, Logros, recompensa diaria, clasificación semanal, eventos temporales y acceso por comando.",
        )
        .addFields(...camposModulos(cfg, acl), ...camposAvanzados(cfg, guildId))
        .setColor(0x1abc9c)
        .setTimestamp();

    return { embeds: [embed], components: [...filasConfigHome(), navRow()] };
}

const hora = (h) => `${String(h).padStart(2, "0")}:00`;

function buildDuendePanel(guildId) {
    const d = guildSettings.getSettings(guildId).duende;
    const embed = new EmbedBuilder()
        .setTitle("🤖 Duende IA")
        .setDescription("Configura modelo, temperatura, historial y canal permitido.")
        .addFields(
            { name: "Modelo", value: d.model || "default", inline: true },
            { name: "Temperatura", value: String(d.temperature), inline: true },
            { name: "Historial", value: String(d.history_limit), inline: true },
            { name: "Canal permitido", value: d.allowed_channel_id ? `<#${d.allowed_channel_id}>` : "cualquiera", inline: true },
            {
                name: "💬 Mensajes solos",
                value: d.espontaneo_enabled
                    ? d.espontaneo_channel_id
                        ? `Activos en <#${d.espontaneo_channel_id}>`
                        : "Activos, pero sin canal elegido (no sale ninguno)"
                    : "Desactivados",
                inline: true,
            },
            {
                // F-DU-02: encima de la personalidad que toque (la de cada canal se pone con /duende set).
                name: "🕐 Tono",
                value:
                    (d.madrugada_activa
                        ? `🌙 Más borde de ${hora(d.madrugada_desde)} a ${hora(d.madrugada_hasta)}`
                        : "🌙 De madrugada: igual que siempre") +
                    "\n" +
                    (guildSettings.parseCsvIds(d.canales_formales).length
                        ? `👔 Más formal en ${guildSettings
                              .parseCsvIds(d.canales_formales)
                              .map((id) => `<#${id}>`)
                              .join(", ")}`
                        : "👔 Ningún canal formal"),
                inline: false,
            },
        )
        .setColor(0x6c5ce7)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende_edit").setLabel("✏️ Editar IA").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende_channel").setLabel("# Canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende_espontaneo").setLabel("💬 Mensajes solos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_apodos_home").setLabel("🏷️ Apodos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_perfiles_home").setLabel("🧠 Perfiles").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende_tono").setLabel("🕐 Tono").setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row, row2, navRow()] };
}

function buildCriptoPanel(guildId) {
    const c = guildSettings.getSettings(guildId).cripto;
    const embed = new EmbedBuilder()
        .setTitle("📈 Cripto")
        .setDescription("Configura comisiones y límites/cooldowns de compra-venta. El precio de TTCL sale del pool de liquidez.")
        .addFields(
            { name: "TTCL", value: "Pool de liquidez: reservas fijas en el código", inline: true },
            { name: "Fees", value: `Compra: **${c.fee_buy_pct}%**\nVenta: **${c.fee_sell_pct}%**`, inline: true },
            { name: "Compra", value: `Min/Max: **${c.min_buy} / ${c.max_buy}**\nCooldown: **${c.cooldown_buy_sec}s**`, inline: true },
            { name: "Venta", value: `Min/Max: **${c.min_sell} / ${c.max_sell}**\nCooldown: **${c.cooldown_sell_sec}s**`, inline: true },
        )
        .setColor(0x9b59b6)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_cripto_market").setLabel("📊 TTCL + fees").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_cripto_limits").setLabel("💱 Límites/cooldown").setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row, navRow()] };
}

function buildCasinoPanel(guildId) {
    const c = guildSettings.getSettings(guildId).casino;
    const embed = new EmbedBuilder()
        .setTitle("🎰 Casino")
        .setDescription(
            "Configura apuesta mínima/máxima, cooldown global, límites diarios y RTP por juego.\n\n_El RTP escala el **premio neto** de cada victoria (100% = sin cambios, 50% = la mitad de premio, 150% = 1.5x premio). Nunca afecta la probabilidad de ganar ni la apuesta devuelta en un empate._",
        )
        .addFields(
            { name: "Límites", value: `Min: **${c.min_bet}**\nMax: **${c.max_bet}**`, inline: true },
            { name: "Frecuencia", value: `Cooldown: **${c.global_cooldown_sec}s**\nDiario: **${c.daily_limit || "∞"}**`, inline: true },
            {
                name: "RTP",
                value: `BJ **${c.rtp_blackjack}%** · Slots **${c.rtp_tragaperras}%**\nRuleta **${c.rtp_ruleta}%** · Adivinar **${c.rtp_adivinar}%**`,
                inline: false,
            },
        )
        .setColor(0xf39c12)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_casino_limits").setLabel("💰 Límites").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_casino_rtp").setLabel("🎲 RTP").setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row, navRow()] };
}

function buildTiendaPanel(guildId) {
    const t = guildSettings.getSettings(guildId).tienda;
    const embed = new EmbedBuilder()
        .setTitle("🛒 Tienda")
        .setDescription("Configura estado de la tienda, cooldown, límite diario y canal de notificaciones.")
        .addFields(
            { name: "Estado", value: t.enabled ? "Activa" : "Desactivada", inline: true },
            { name: "Cooldown compra", value: `${t.buy_cooldown_sec}s`, inline: true },
            { name: "Límite diario", value: t.daily_limit ? String(t.daily_limit) : "∞", inline: true },
            { name: "Canal notif", value: t.notif_channel_id ? `<#${t.notif_channel_id}>` : "No configurado", inline: false },
        )
        .setColor(0x2ecc71)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_tienda_edit").setLabel("✏️ Editar tienda").setStyle(ButtonStyle.Primary),
    );

    return { embeds: [embed], components: [row, navRow()] };
}

function buildAclPanel(guildId) {
    const rules = guildSettings.listCommandAcl(guildId);
    const lines = rules.length
        ? rules.slice(0, 10).map((r) => {
              const ch = r.allowedChannels.length ? `${r.allowedChannels.length} canales` : "all-ch";
              const roles = r.allowedRoles.length ? `${r.allowedRoles.length} roles` : "all-roles";
              return `• /${r.command}: ${r.enabled ? "ON" : "OFF"} · ${ch} · ${roles}`;
          })
        : ["_Sin reglas personalizadas. Todo permitido por defecto._"];

    const embed = new EmbedBuilder()
        .setTitle("🔐 ACL de comandos")
        .setDescription("Habilita o restringe comandos por canal y rol.\n\n" + lines.join("\n"))
        .setColor(0xe74c3c)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_acl_edit").setLabel("✏️ Editar regla").setStyle(ButtonStyle.Primary),
    );

    return { embeds: [embed], components: [row, navRow()] };
}

function buildLogrosPanel(guildId) {
    const l = guildSettings.getSettings(guildId).logros;
    const embed = new EmbedBuilder()
        .setTitle("🏅 Logros")
        .setDescription("Configura estado del sistema de logros, canal de anuncios y categorías desactivadas.")
        .addFields(
            { name: "Estado", value: l.enabled ? "Activo" : "Desactivado", inline: true },
            { name: "Multiplicador recompensa", value: `x${l.reward_multiplier}`, inline: true },
            { name: "Canal anuncio", value: l.notify_channel_id ? `<#${l.notify_channel_id}>` : "No configurado", inline: true },
            { name: "Categorías desactivadas", value: l.disabled_categories || "ninguna", inline: false },
        )
        .setColor(0xf1c40f)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_logros_edit").setLabel("✏️ Editar logros").setStyle(ButtonStyle.Primary),
    );

    return { embeds: [embed], components: [row, navRow()] };
}

function buildDiarioPanel(guildId) {
    const d = guildSettings.getSettings(guildId).diario;
    const { cantidadPara } = require("../../systems/diario");
    const ejemplos = [0, 5, 10, 20, 30].map((r) => `racha ${r}: **${cantidadPara(d, r)}**`).join(" · ");
    const embed = new EmbedBuilder()
        .setTitle("🎁 Recompensa diaria")
        .setDescription(
            "Una vez al día (hora de Madrid), en /perfil → 💰 Economía → 🎁 Diario. Va al efectivo y crece con la racha de XP: " +
                "base + por día de racha, hasta el tope.\n\n" +
                ejemplos,
        )
        .addFields(
            { name: "Estado", value: d.enabled ? "Activa" : "Desactivada", inline: true },
            { name: "Base", value: String(d.base), inline: true },
            { name: "Por día de racha", value: String(d.por_dia_racha), inline: true },
            { name: "Tope", value: String(d.tope), inline: true },
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_diario_edit").setLabel("✏️ Editar diario").setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row, navRow()] };
}

/** 🎉 Eventos temporales (F-EC-02): happy hour de XP y fin de semana del casino, y si están en marcha ahora. */

function buildEventosPanel(guildId) {
    const { xp, casino } = require("../../systems/eventos").estado(guildId);
    const horaDelDia = (h) => `${String(h).padStart(2, "0")}:00`;
    const ahora = (e) => (e.enMarcha ? " · 🟢 **en marcha**" : "");
    const embed = new EmbedBuilder()
        .setTitle("🎉 Eventos temporales")
        .setDescription(
            "Durante un rato, los multiplicadores suben solos (hora de Madrid). La gente lo ve en /perfil (la happy hour) y en " +
                "/juegos → 🎰 Casino (el fin de semana).",
        )
        .addFields(
            {
                name: "⚡ Happy hour de XP",
                value: xp.activo
                    ? `Cada día de ${horaDelDia(xp.desde)} a ${horaDelDia(xp.hasta)}: XP **×${fmtNumero(xp.mult)}**${ahora(xp)}\n` +
                      "Encima del multiplicador global y antes del bonus de racha."
                    : "Desactivada",
            },
            {
                name: "🎰 Fin de semana del casino",
                value: casino.activo
                    ? `Sábado y domingo: premio neto de cada victoria al **${fmtNumero(casino.pct)} %**${ahora(casino)}\n` +
                      "Encima del RTP de cada juego (blackjack, tragaperras, ruleta y adivinar)."
                    : "Desactivado",
            },
        )
        .setColor(0x9b59b6)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_eventos_xp").setLabel("⚡ Happy hour").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_eventos_casino").setLabel("🎰 Fin de semana").setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row, navRow()] };
}

module.exports = {
    navRow,
    buildConfigHome,
    hora,
    buildDuendePanel,
    buildCriptoPanel,
    buildCasinoPanel,
    buildTiendaPanel,
    buildAclPanel,
    buildLogrosPanel,
    buildDiarioPanel,
    buildEventosPanel,
};
