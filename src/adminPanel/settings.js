const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const impuestos = require("../systems/impuestos");
const { simpleModal, fmt } = require("./common");

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

function buildConfigHome(guildId) {
    const cfg = guildSettings.getSettings(guildId);
    const acl = guildSettings.listCommandAcl(guildId);
    const embed = new EmbedBuilder()
        .setTitle("⚙️ Configuración Global")
        .setDescription("Administra parámetros de Duende, Cripto, Casino, Tienda, Logros, recompensa diaria y acceso por comando.")
        .addFields(
            {
                name: "🤖 Duende IA",
                value: `Modelo: **${cfg.duende.model || "default"}**\nTemp: **${cfg.duende.temperature}**`,
                inline: true,
            },
            {
                name: "📈 Cripto",
                value: `TTCL base: **${cfg.cripto.ttcl_base_price}**\nVolatilidad: **${cfg.cripto.ttcl_volatility}**\nFee buy/sell: **${cfg.cripto.fee_buy_pct}% / ${cfg.cripto.fee_sell_pct}%**`,
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
            {
                name: "🔐 ACL comandos",
                value: `Reglas activas: **${acl.length}**`,
                inline: true,
            },
            {
                name: "🏅 Logros",
                value: `Estado: **${cfg.logros.enabled ? "Activo" : "Off"}**\nMultiplicador: **x${cfg.logros.reward_multiplier}**`,
                inline: true,
            },
            {
                name: "🎁 Diario",
                value: cfg.diario.enabled
                    ? `**${cfg.diario.base}** + **${cfg.diario.por_dia_racha}**/día de racha\nTope: **${cfg.diario.tope}**`
                    : "Desactivado",
                inline: true,
            },
            {
                name: "🏛️ Impuestos",
                value: `Reglas activas: **${impuestos.listarReglas(guildId).filter((r) => r.activo).length}**\nBote: **${fmt(impuestos.boteTotal(guildId))}**`,
                inline: true,
            },
        )
        .setColor(0x1abc9c)
        .setTimestamp();

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
    );

    return { embeds: [embed], components: [row1, row2, navRow()] };
}

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

    return { embeds: [embed], components: [row, navRow()] };
}

function buildCriptoPanel(guildId) {
    const c = guildSettings.getSettings(guildId).cripto;
    const embed = new EmbedBuilder()
        .setTitle("📈 Cripto")
        .setDescription("Configura TTCL, comisiones y límites/cooldowns de compra-venta.")
        .addFields(
            { name: "TTCL", value: `Base: **${c.ttcl_base_price}**\nVolatilidad: **${c.ttcl_volatility}**`, inline: true },
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
    const { cantidadPara } = require("../systems/diario");
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

async function handleSettingsButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_cfg_home") {
        await interaction.update(buildConfigHome(guildId));
        return true;
    }

    if (id === "paneladmin_cfg_duende") {
        await interaction.update(buildDuendePanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_cripto") {
        await interaction.update(buildCriptoPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_casino") {
        await interaction.update(buildCasinoPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_tienda") {
        await interaction.update(buildTiendaPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_acl") {
        await interaction.update(buildAclPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_logros") {
        await interaction.update(buildLogrosPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_diario") {
        await interaction.update(buildDiarioPanel(guildId));
        return true;
    }
    if (id === "paneladmin_cfg_diario_edit") {
        const d = guildSettings.getSettings(guildId).diario;
        await interaction.showModal(
            simpleModal("paneladmin_cfg_diario_modal", "Recompensa diaria", [
                { id: "enabled", label: "Activa (1/0)", value: d.enabled ? "1" : "0" },
                { id: "base", label: "Base (monedas con racha 0)", value: String(d.base) },
                { id: "porDia", label: "Monedas por día de racha", value: String(d.por_dia_racha) },
                { id: "tope", label: "Tope (máximo al día)", value: String(d.tope) },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_cfg_duende_edit") {
        const d = guildSettings.getSettings(guildId).duende;
        const modal = simpleModal("paneladmin_cfg_duende_modal", "Duende IA", [
            { id: "model", label: "Modelo (vacío = default)", required: false, value: d.model || "" },
            { id: "temperature", label: "Temperatura (0-2)", required: true, value: String(d.temperature) },
            { id: "history", label: "Límite historial", required: true, value: String(d.history_limit) },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_duende_channel") {
        const d = guildSettings.getSettings(guildId).duende;
        const modal = simpleModal("paneladmin_cfg_duende_channel_modal", "Canal Duende", [
            { id: "channel", label: "ID de canal (vacío = cualquiera)", required: false, value: d.allowed_channel_id || "" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_duende_espontaneo") {
        const d = guildSettings.getSettings(guildId).duende;
        const modal = simpleModal("paneladmin_cfg_duende_espontaneo_modal", "Duende: mensajes solos", [
            { id: "enabled", label: "Activos (1/0)", value: d.espontaneo_enabled ? "1" : "0" },
            { id: "channel", label: "ID de canal (vacío = no sale ninguno)", required: false, value: d.espontaneo_channel_id || "" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_cripto_market") {
        const c = guildSettings.getSettings(guildId).cripto;
        const modal = simpleModal("paneladmin_cfg_cripto_market_modal", "Cripto: TTCL + Fees", [
            { id: "base", label: "TTCL precio base", value: String(c.ttcl_base_price) },
            { id: "vol", label: "TTCL volatilidad", value: String(c.ttcl_volatility) },
            { id: "feeBuy", label: "Fee compra %", value: String(c.fee_buy_pct) },
            { id: "feeSell", label: "Fee venta %", value: String(c.fee_sell_pct) },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_cripto_limits") {
        const c = guildSettings.getSettings(guildId).cripto;
        const modal = simpleModal("paneladmin_cfg_cripto_limits_modal", "Cripto: Límites", [
            { id: "minBuy", label: "Compra mínima", value: String(c.min_buy) },
            { id: "maxBuy", label: "Compra máxima", value: String(c.max_buy) },
            { id: "buyCd", label: "Cooldown compra (s)", value: String(c.cooldown_buy_sec) },
            { id: "minSell", label: "Venta mínima", value: String(c.min_sell) },
            { id: "maxSell", label: "Venta máxima", value: String(c.max_sell) },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_casino_limits") {
        const c = guildSettings.getSettings(guildId).casino;
        const modal = simpleModal("paneladmin_cfg_casino_limits_modal", "Casino: Límites", [
            { id: "min", label: "Apuesta mínima", value: String(c.min_bet) },
            { id: "max", label: "Apuesta máxima", value: String(c.max_bet) },
            { id: "cooldown", label: "Cooldown global (s)", value: String(c.global_cooldown_sec) },
            { id: "daily", label: "Límite diario (0 sin límite)", value: String(c.daily_limit) },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_casino_rtp") {
        const c = guildSettings.getSettings(guildId).casino;
        const modal = simpleModal("paneladmin_cfg_casino_rtp_modal", "Casino: RTP", [
            { id: "bj", label: "Blackjack RTP %", value: String(c.rtp_blackjack) },
            { id: "slots", label: "Tragaperras RTP %", value: String(c.rtp_tragaperras) },
            { id: "ruleta", label: "Ruleta RTP %", value: String(c.rtp_ruleta) },
            { id: "adivinar", label: "Adivinar RTP %", value: String(c.rtp_adivinar) },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_tienda_edit") {
        const t = guildSettings.getSettings(guildId).tienda;
        const modal = simpleModal("paneladmin_cfg_tienda_modal", "Tienda", [
            { id: "enabled", label: "Activa (1/0)", value: t.enabled ? "1" : "0" },
            { id: "buyCd", label: "Cooldown compra (s)", value: String(t.buy_cooldown_sec) },
            { id: "daily", label: "Límite diario (0 sin límite)", value: String(t.daily_limit) },
            { id: "channel", label: "ID canal notificaciones", required: false, value: t.notif_channel_id || "" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_acl_edit") {
        const modal = simpleModal("paneladmin_cfg_acl_modal", "ACL comando", [
            { id: "command", label: "Comando (sin /)", value: "" },
            { id: "enabled", label: "Habilitado (1/0)", value: "1" },
            { id: "channels", label: "Canales CSV (IDs)", required: false, value: "" },
            { id: "roles", label: "Roles CSV (IDs)", required: false, value: "" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (id === "paneladmin_cfg_logros_edit") {
        const l = guildSettings.getSettings(guildId).logros;
        const modal = simpleModal("paneladmin_cfg_logros_modal", "Logros", [
            { id: "enabled", label: "Activo (1/0)", value: l.enabled ? "1" : "0" },
            { id: "mult", label: "Multiplicador recompensas", value: String(l.reward_multiplier || 1) },
            { id: "channel", label: "Canal anuncio (ID)", required: false, value: l.notify_channel_id || "" },
            { id: "disabled", label: "Categorías off (csv)", required: false, value: l.disabled_categories || "" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    return false;
}

async function handleSettingsModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_cfg_duende_modal") {
        const modeloAntes = guildSettings.getSettings(guildId).duende.model;
        const modelo = interaction.fields.getTextInputValue("model").trim();
        guildSettings.setManySettings(guildId, {
            "duende.model": modelo,
            "duende.temperature": interaction.fields.getTextInputValue("temperature").trim(),
            "duende.history_limit": interaction.fields.getTextInputValue("history").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.duende.update" });
        if (modelo === modeloAntes) {
            await interaction.reply({ content: "✅ Configuración de Duende actualizada.", flags: MessageFlags.Ephemeral });
            return true;
        }
        // Modelo nuevo: se prueba ya, en vez de descubrir en el chat que no existe o que no usa las herramientas.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { comprobarModelo, modeloDe, textoComprobacion } = require("../services/duende/gemini");
        const r = await comprobarModelo(modeloDe(guildId));
        await interaction.editReply({
            content:
                `✅ Configuración de Duende actualizada.\n${textoComprobacion(r)}` +
                (r.ok ? "" : "\nVuelve a ✏️ Editar IA y pon otro modelo (o déjalo vacío para el de .env)."),
        });
        return true;
    }

    if (id === "paneladmin_cfg_duende_channel_modal") {
        const channelId = interaction.fields.getTextInputValue("channel").trim();
        guildSettings.setSetting(guildId, "duende.allowed_channel_id", channelId);
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "settings.duende.channel",
            details: { channelId: channelId || null },
        });
        await interaction.reply({ content: "✅ Canal permitido de Duende actualizado.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_duende_espontaneo_modal") {
        const channelId = interaction.fields.getTextInputValue("channel").trim();
        guildSettings.setManySettings(guildId, {
            "duende.espontaneo_enabled": interaction.fields.getTextInputValue("enabled").trim(),
            "duende.espontaneo_channel_id": channelId,
        });
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "settings.duende.espontaneo",
            details: { channelId: channelId || null },
        });
        await interaction.reply({ content: "✅ Mensajes espontáneos del Duende actualizados.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_cripto_market_modal") {
        guildSettings.setManySettings(guildId, {
            "cripto.ttcl_base_price": interaction.fields.getTextInputValue("base").trim(),
            "cripto.ttcl_volatility": interaction.fields.getTextInputValue("vol").trim(),
            "cripto.fee_buy_pct": interaction.fields.getTextInputValue("feeBuy").trim(),
            "cripto.fee_sell_pct": interaction.fields.getTextInputValue("feeSell").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.cripto.market" });
        await interaction.reply({ content: "✅ Configuración de mercado cripto actualizada.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_cripto_limits_modal") {
        guildSettings.setManySettings(guildId, {
            "cripto.min_buy": interaction.fields.getTextInputValue("minBuy").trim(),
            "cripto.max_buy": interaction.fields.getTextInputValue("maxBuy").trim(),
            "cripto.cooldown_buy_sec": interaction.fields.getTextInputValue("buyCd").trim(),
            "cripto.min_sell": interaction.fields.getTextInputValue("minSell").trim(),
            "cripto.max_sell": interaction.fields.getTextInputValue("maxSell").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.cripto.limits" });
        await interaction.reply({ content: "✅ Límites de compra/venta cripto actualizados.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_casino_limits_modal") {
        guildSettings.setManySettings(guildId, {
            "casino.min_bet": interaction.fields.getTextInputValue("min").trim(),
            "casino.max_bet": interaction.fields.getTextInputValue("max").trim(),
            "casino.global_cooldown_sec": interaction.fields.getTextInputValue("cooldown").trim(),
            "casino.daily_limit": interaction.fields.getTextInputValue("daily").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.casino.limits" });
        await interaction.reply({ content: "✅ Límites de casino actualizados.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_casino_rtp_modal") {
        guildSettings.setManySettings(guildId, {
            "casino.rtp_blackjack": interaction.fields.getTextInputValue("bj").trim(),
            "casino.rtp_tragaperras": interaction.fields.getTextInputValue("slots").trim(),
            "casino.rtp_ruleta": interaction.fields.getTextInputValue("ruleta").trim(),
            "casino.rtp_adivinar": interaction.fields.getTextInputValue("adivinar").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.casino.rtp" });
        await interaction.reply({ content: "✅ RTP de casino actualizado.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_tienda_modal") {
        guildSettings.setManySettings(guildId, {
            "tienda.enabled": interaction.fields.getTextInputValue("enabled").trim(),
            "tienda.buy_cooldown_sec": interaction.fields.getTextInputValue("buyCd").trim(),
            "tienda.daily_limit": interaction.fields.getTextInputValue("daily").trim(),
            "tienda.notif_channel_id": interaction.fields.getTextInputValue("channel").trim(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.tienda.update" });
        await interaction.reply({ content: "✅ Configuración de tienda actualizada.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_acl_modal") {
        const command = interaction.fields.getTextInputValue("command").trim().replace(/^\//, "").toLowerCase();
        const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
        const channelsRaw = interaction.fields.getTextInputValue("channels").trim();
        const rolesRaw = interaction.fields.getTextInputValue("roles").trim();

        if (!command) {
            await interaction.reply({ content: "❌ Debes indicar un comando.", flags: MessageFlags.Ephemeral });
            return true;
        }

        guildSettings.setCommandAcl(guildId, command, {
            enabled: enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "si",
            allowedChannels: guildSettings.parseCsvIds(channelsRaw),
            allowedRoles: guildSettings.parseCsvIds(rolesRaw),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.acl.update", details: { command } });

        await interaction.reply({ content: `✅ ACL actualizada para /${command}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_logros_modal") {
        guildSettings.setManySettings(guildId, {
            "logros.enabled": interaction.fields.getTextInputValue("enabled").trim(),
            "logros.reward_multiplier": interaction.fields.getTextInputValue("mult").trim(),
            "logros.notify_channel_id": interaction.fields.getTextInputValue("channel").trim(),
            "logros.disabled_categories": interaction.fields.getTextInputValue("disabled").trim().toLowerCase(),
        });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.logros.update" });
        await interaction.reply({ content: "✅ Configuración de logros actualizada.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_cfg_diario_modal") {
        const numeros = { base: "diario.base", porDia: "diario.por_dia_racha", tope: "diario.tope" };
        const valores = {};
        for (const [campo, clave] of Object.entries(numeros)) {
            const n = Number(interaction.fields.getTextInputValue(campo).trim());
            if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
                await interaction.reply({
                    content: "❌ Base, monedas por día y tope tienen que ser números enteros entre 0 y 1.000.000.",
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
            valores[clave] = n;
        }
        guildSettings.setManySettings(guildId, { "diario.enabled": interaction.fields.getTextInputValue("enabled").trim(), ...valores });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "settings.diario.update", details: valores });
        if (interaction.isFromMessage?.()) await interaction.update(buildDiarioPanel(guildId));
        else await interaction.reply({ content: "✅ Recompensa diaria actualizada.", flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = {
    buildConfigHome,
    handleSettingsButton,
    handleSettingsModal,
};
