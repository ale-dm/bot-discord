// Panel admin → Niveles → ⚙️ Configuración: XP por mensaje y voz, multiplicador, fórmula, racha y
// canal de anuncios (con la vista previa de la curva de XP).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");

async function accionConfig(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    const embed = new EmbedBuilder()
        .setTitle("⚙️ Configuración XP")
        .setDescription("Ajusta parámetros base del sistema de niveles.")
        .addFields(
            { name: "XP mensaje", value: `${cfg.xp_message_base} (+${cfg.xp_message_len_bonus_max})`, inline: true },
            { name: "Cooldown", value: `${cfg.xp_message_cooldown_sec}s`, inline: true },
            { name: "XP voz/min", value: `${cfg.xp_voice_per_min}`, inline: true },
            { name: "Multiplicador", value: `x${cfg.xp_multiplier}`, inline: true },
            {
                name: "Fórmula",
                value: `${cfg.xp_formula_base} × (N+1)^${cfg.xp_formula_exp} × ${cfg.xp_level_cost_multiplier} × ${cfg.xp_level_requirement_multiplier}`,
                inline: true,
            },
            {
                name: "Canal anuncio",
                value: cfg.xp_announce_channel_id ? `<#${cfg.xp_announce_channel_id}>` : "No configurado",
                inline: true,
            },
            {
                name: "Racha diaria",
                value:
                    cfg.streak_enabled === "0"
                        ? "Desactivada"
                        : `+${cfg.streak_bonus_pct_per_day}%/día (máx +${cfg.streak_bonus_cap_pct}%)`,
                inline: true,
            },
        )
        .setColor(0x00b894);
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_msg").setLabel("📝 Mensajes").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_voice").setLabel("🎙️ Voz").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_mult").setLabel("⚡ Multiplicador").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_formula").setLabel("🧮 Fórmula").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_channel").setLabel("📢 Canal anuncio").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_streak").setLabel("🔥 Racha").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_formula_preview").setLabel("📈 Vista previa").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [row1, row2] });
    return true;
}

async function accionCfgMsg(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    await interaction.showModal(
        simpleModal("paneladmin_levels_cfg_msg_modal", "Config XP mensajes", [
            { id: "xp_base", label: "XP base", value: cfg.xp_message_base },
            { id: "xp_bonus", label: "Bonus máx longitud", value: cfg.xp_message_len_bonus_max },
            { id: "xp_cd", label: "Cooldown (s)", value: cfg.xp_message_cooldown_sec },
        ]),
    );
    return true;
}

async function accionCfgVoice(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    await interaction.showModal(
        simpleModal("paneladmin_levels_cfg_voice_modal", "Config XP voz", [
            { id: "xp_voice", label: "XP por minuto", value: cfg.xp_voice_per_min },
        ]),
    );
    return true;
}

async function accionCfgMult(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    await interaction.showModal(
        simpleModal("paneladmin_levels_cfg_mult_modal", "Multiplicador XP", [
            { id: "xp_mult", label: "Multiplicador", value: cfg.xp_multiplier },
        ]),
    );
    return true;
}

async function accionCfgFormula(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    await interaction.showModal(
        simpleModal("paneladmin_levels_cfg_formula_modal", "Fórmula", [
            { id: "formula_base", label: "Base", value: cfg.xp_formula_base },
            { id: "formula_exp", label: "Exponente", value: cfg.xp_formula_exp },
            { id: "cost_mult", label: "Multiplicador de coste", value: cfg.xp_level_cost_multiplier },
            { id: "req_mult", label: "Multiplicador de requisito", value: cfg.xp_level_requirement_multiplier },
        ]),
    );
    return true;
}

async function accionCfgStreak(interaction, id, guildId) {
    const cfg = xp.getAllConfig(guildId);
    await interaction.showModal(
        simpleModal("paneladmin_levels_cfg_streak_modal", "Racha diaria", [
            { id: "enabled", label: "Activada (si/no)", value: cfg.streak_enabled === "0" ? "no" : "si" },
            { id: "pct_per_day", label: "% bonus XP por día de racha", value: cfg.streak_bonus_pct_per_day },
            { id: "cap_pct", label: "% bonus máximo", value: cfg.streak_bonus_cap_pct },
        ]),
    );
    return true;
}

async function accionFormulaPreview(interaction, id, guildId) {
    const titles = xp.getTitles(guildId);
    const levels = [...new Set([5, ...titles.map((t) => t.nivel)])].sort((a, b) => a - b);

    const lines = [];
    let cumulative = 0;
    let nextTitleIdx = 0;
    for (let lvl = 0; lvl < Math.max(...levels); lvl++) {
        cumulative += xp.xpForNextLevel(lvl, guildId);
        if (levels[nextTitleIdx] === lvl + 1) {
            const info = xp.titleForLevel(guildId, lvl + 1);
            const cost = xp.xpForNextLevel(lvl, guildId);
            lines.push(
                `${info.emoji || "▫️"} **LVL ${lvl + 1}**${info.title ? ` · ${info.title}` : ""} — ${cost.toLocaleString()} XP para subir · ${cumulative.toLocaleString()} XP acumulado`,
            );
            nextTitleIdx++;
        }
    }

    const cfg = xp.getAllConfig(guildId);
    const embed = new EmbedBuilder()
        .setTitle("📈 Vista previa de la curva de XP")
        .setDescription(
            `Fórmula actual: ${cfg.xp_formula_base} × (N+1)^${cfg.xp_formula_exp} × ${cfg.xp_level_cost_multiplier} × ${cfg.xp_level_requirement_multiplier}\n\n${lines.join("\n") || "No hay niveles configurados."}`,
        )
        .setColor(0x00b894);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionCfgChannel(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId("paneladmin_levels_cfg_channel_select")
            .setPlaceholder("Selecciona canal de anuncios")
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_cfg_channel_clear").setLabel("Quitar canal").setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ content: "Configura el canal de anuncios:", components: [row, actions], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionCfgChannelClear(interaction, id, guildId) {
    xp.setConfig(guildId, "xp_announce_channel_id", "");
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "xp.config.announce_channel",
        details: { channelId: null },
    });
    await interaction.update({ content: "✅ Canal de anuncios eliminado.", components: [] });
    return true;
}

const ACCIONES_NIVELES = [
    [(id) => id === "paneladmin_levels_config", accionConfig],
    [(id) => id === "paneladmin_levels_cfg_msg", accionCfgMsg],
    [(id) => id === "paneladmin_levels_cfg_voice", accionCfgVoice],
    [(id) => id === "paneladmin_levels_cfg_mult", accionCfgMult],
    [(id) => id === "paneladmin_levels_cfg_formula", accionCfgFormula],
    [(id) => id === "paneladmin_levels_cfg_streak", accionCfgStreak],
    [(id) => id === "paneladmin_levels_formula_preview", accionFormulaPreview],
    [(id) => id === "paneladmin_levels_cfg_channel", accionCfgChannel],
    [(id) => id === "paneladmin_levels_cfg_channel_clear", accionCfgChannelClear],
];

async function boton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    for (const [encaja, accion] of ACCIONES_NIVELES) {
        if (encaja(id)) return accion(interaction, id, guildId);
    }
    return false;
}

async function modalMensajes(interaction) {
    const guildId = interaction.guildId;
    const base = Math.max(1, parseInt(interaction.fields.getTextInputValue("xp_base"), 10));
    const bonus = Math.max(0, parseInt(interaction.fields.getTextInputValue("xp_bonus"), 10));
    const cd = Math.max(0, parseInt(interaction.fields.getTextInputValue("xp_cd"), 10));
    xp.setConfig(guildId, "xp_message_base", base);
    xp.setConfig(guildId, "xp_message_len_bonus_max", bonus);
    xp.setConfig(guildId, "xp_message_cooldown_sec", cd);
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.messages" });
    await interaction.reply({ content: "✅ Config mensajes actualizada.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalVoz(interaction) {
    const guildId = interaction.guildId;
    xp.setConfig(guildId, "xp_voice_per_min", Math.max(0, parseFloat(interaction.fields.getTextInputValue("xp_voice"))));
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.voice" });
    await interaction.reply({ content: "✅ XP voz actualizada.", flags: MessageFlags.Ephemeral });
    return true;
}

async function modalMultiplicador(interaction) {
    const guildId = interaction.guildId;
    const mult = Math.max(0, parseFloat(interaction.fields.getTextInputValue("xp_mult")));
    xp.setConfig(guildId, "xp_multiplier", mult);
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.multiplier", details: { mult } });
    await interaction.reply({ content: `✅ Multiplicador x${mult}.`, flags: MessageFlags.Ephemeral });
    return true;
}

async function modalFormula(interaction) {
    const guildId = interaction.guildId;
    const base = Math.max(1, parseFloat(interaction.fields.getTextInputValue("formula_base")));
    const exp = Math.max(1, parseFloat(interaction.fields.getTextInputValue("formula_exp")));
    const costMult = Math.max(1, parseFloat(interaction.fields.getTextInputValue("cost_mult")));
    const reqMult = Math.max(1, parseFloat(interaction.fields.getTextInputValue("req_mult")));
    xp.setConfig(guildId, "xp_formula_base", base);
    xp.setConfig(guildId, "xp_formula_exp", exp);
    xp.setConfig(guildId, "xp_level_cost_multiplier", costMult);
    xp.setConfig(guildId, "xp_level_requirement_multiplier", reqMult);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "xp.config.formula",
        details: { base, exp, costMult, reqMult },
    });
    await interaction.reply({
        content: `✅ Fórmula ${base} × (N+1)^${exp} × ${costMult} × ${reqMult}.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function modalRacha(interaction) {
    const guildId = interaction.guildId;
    const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
    const enabled = !["no", "n", "0", "false"].includes(enabledRaw);
    const pctPerDay = Math.max(0, parseFloat(interaction.fields.getTextInputValue("pct_per_day")));
    const capPct = Math.max(0, parseFloat(interaction.fields.getTextInputValue("cap_pct")));
    if (isNaN(pctPerDay) || isNaN(capPct)) {
        await interaction.reply({ content: "Valores inválidos.", flags: MessageFlags.Ephemeral });
        return true;
    }
    xp.setConfig(guildId, "streak_enabled", enabled ? "1" : "0");
    xp.setConfig(guildId, "streak_bonus_pct_per_day", pctPerDay);
    xp.setConfig(guildId, "streak_bonus_cap_pct", capPct);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "xp.config.streak",
        details: { enabled, pctPerDay, capPct },
    });
    await interaction.reply({
        content: `✅ Racha ${enabled ? "activada" : "desactivada"}: +${pctPerDay}%/día (máx +${capPct}%).`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function modal(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_levels_cfg_msg_modal") return modalMensajes(interaction);
    if (id === "paneladmin_levels_cfg_voice_modal") return modalVoz(interaction);
    if (id === "paneladmin_levels_cfg_mult_modal") return modalMultiplicador(interaction);
    if (id === "paneladmin_levels_cfg_formula_modal") return modalFormula(interaction);
    if (id === "paneladmin_levels_cfg_streak_modal") return modalRacha(interaction);
    return false;
}

async function selectCanal(interaction) {
    if (interaction.customId === "paneladmin_levels_cfg_channel_select") {
        const channelId = interaction.values[0];
        xp.setConfig(interaction.guildId, "xp_announce_channel_id", channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "xp.config.announce_channel",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal anuncio: <#${channelId}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { boton, modal, selectCanal };
