const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    ChannelType,
} = require("discord.js");
const xp = require("../systems/xpSystem");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");
const { levelsHomeRows, buildXpHome } = require("./views");

const rewardSearchSessions = new Map();

function buildRewardRoleSearchPayload(guild, userId, nivel, page = 0) {
    const key = `${guild.id}:${userId}:${nivel}`;
    const session = rewardSearchSessions.get(key);
    if (!session) {
        return { content: "Sesión caducada. Repite la búsqueda.", components: [], ephemeral: true };
    }

    const allRoleIds = session.roleIds || [];
    const pageSize = 25;
    const maxPage = Math.max(0, Math.ceil(allRoleIds.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const sliceIds = allRoleIds.slice(start, start + pageSize);
    const options = sliceIds
        .map((roleId) => guild.roles.cache.get(roleId))
        .filter(Boolean)
        .map((role) => ({ label: role.name.slice(0, 100), value: role.id }));

    const rows = [];
    if (options.length > 0) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`paneladmin_levels_reward_search_pick_${nivel}`)
                    .setPlaceholder(`Rol para LVL ${nivel} (${safePage + 1}/${maxPage + 1})`)
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(options),
            ),
        );
    }

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`paneladmin_levels_reward_search_page_${nivel}_${safePage - 1}`)
                .setLabel("◀")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage <= 0),
            new ButtonBuilder()
                .setCustomId(`paneladmin_levels_reward_search_page_${nivel}_${safePage + 1}`)
                .setLabel("▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= maxPage),
        ),
    );

    if (options.length === 0) {
        return { content: `No encontré roles para "${session.query}"`, components: rows, ephemeral: true };
    }

    return {
        content: `Resultados para "${session.query}" (LVL ${nivel})`,
        components: rows,
        ephemeral: true,
    };
}

async function handleLevelsButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_home") {
        xp.ensureGuildDefaults(guildId);
        await interaction.update({ embeds: [buildXpHome(guildId)], components: levelsHomeRows() });
        return true;
    }

    if (id === "paneladmin_levels_config") {
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
            new ButtonBuilder()
                .setCustomId("paneladmin_levels_formula_preview")
                .setLabel("📈 Vista previa")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row1, row2] });
        return true;
    }

    if (id === "paneladmin_levels_rewards") {
        const rewards = xp.getRewards(guildId);
        const lines =
            rewards
                .map((r) => `• **LVL ${r.nivel}** → <@&${r.roleId}>${r.descripcion ? ` — ${r.emoji || "🔓"} ${r.descripcion}` : ""}`)
                .join("\n") || "No hay recompensas configuradas.";
        const embed = new EmbedBuilder()
            .setTitle("🎭 Recompensas de niveles")
            .setDescription(lines)
            .addFields({
                name: "No aparece un rol",
                value: "Usa **Añadir por ID** para asignarlo por mención/ID cuando no salga en el selector.",
            })
            .setColor(0x9b59b6);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_levels_reward_add").setLabel("➕ Añadir/editar").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_levels_reward_search").setLabel("🔎 Buscar rol").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("paneladmin_levels_reward_add_manual")
                .setLabel("🆔 Añadir por ID")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_reward_remove").setLabel("🗑️ Quitar").setStyle(ButtonStyle.Danger),
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_levels_reward_desc").setLabel("📝 Descripción").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row, row2] });
        return true;
    }

    if (id === "paneladmin_levels_users") {
        const embed = new EmbedBuilder()
            .setTitle("👤 Gestión XP usuarios")
            .setDescription("Ajusta, consulta o resetea XP.")
            .setColor(0xe17055);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_levels_user_adjust").setLabel("± XP usuario").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_levels_user_reset").setLabel("Reset XP").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_levels_user_view").setLabel("Ver perfil").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("paneladmin_levels_user_mult")
                .setLabel("⚙️ Multiplicador usuario")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
        return true;
    }

    if (id === "paneladmin_levels_ignored") {
        const ignored = xp.getIgnoredChannels(guildId);
        const lines = ignored.map((c) => `• <#${c.channelId}>`).join("\n") || "No hay canales ignorados.";
        const embed = new EmbedBuilder().setTitle("🚫 Canales ignorados XP").setDescription(lines).setColor(0x636e72);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_add").setLabel("➕ Ignorar canal").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_remove").setLabel("➖ Quitar").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("paneladmin_levels_ignored_clear").setLabel("🧹 Limpiar").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
        return true;
    }

    if (id === "paneladmin_levels_cfg_msg") {
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

    if (id === "paneladmin_levels_cfg_voice") {
        const cfg = xp.getAllConfig(guildId);
        await interaction.showModal(
            simpleModal("paneladmin_levels_cfg_voice_modal", "Config XP voz", [
                { id: "xp_voice", label: "XP por minuto", value: cfg.xp_voice_per_min },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_cfg_mult") {
        const cfg = xp.getAllConfig(guildId);
        await interaction.showModal(
            simpleModal("paneladmin_levels_cfg_mult_modal", "Multiplicador XP", [
                { id: "xp_mult", label: "Multiplicador", value: cfg.xp_multiplier },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_cfg_formula") {
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

    if (id === "paneladmin_levels_cfg_streak") {
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

    if (id === "paneladmin_levels_formula_preview") {
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
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_channel") {
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
        await interaction.reply({ content: "Configura el canal de anuncios:", components: [row, actions], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_channel_clear") {
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

    if (id === "paneladmin_levels_reward_add") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_reward_add_modal", "Añadir recompensa", [{ id: "nivel", label: "Nivel", placeholder: "30" }]),
        );
        return true;
    }

    if (id === "paneladmin_levels_reward_desc") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_reward_desc_modal", "Descripción de una recompensa", [
                { id: "nivel", label: "Nivel", placeholder: "12" },
                { id: "role_id", label: "ID del rol", placeholder: "1474049913829462016" },
                { id: "emoji", label: "Emoji (opcional)", placeholder: "🚶", required: false },
                {
                    id: "descripcion",
                    label: "Qué desbloquea (vacío = es un rango)",
                    placeholder: "Mover usuarios entre canales de voz",
                    required: false,
                },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_reward_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_reward_remove_modal", "Quitar recompensa", [
                { id: "nivel", label: "Nivel", placeholder: "30" },
                { id: "role_id", label: "Rol a quitar (vacío = TODOS en ese nivel)", required: false, placeholder: "<@&123...> o 123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_reward_search") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_reward_search_modal", "Buscar rol por nombre", [
                { id: "nivel", label: "Nivel", placeholder: "30" },
                { id: "query", label: "Texto del rol", placeholder: "moderador" },
            ]),
        );
        return true;
    }

    if (id.startsWith("paneladmin_levels_reward_search_page_")) {
        const parts = id.split("_");
        const nivel = parseInt(parts[parts.length - 2], 10);
        const page = parseInt(parts[parts.length - 1], 10);
        await interaction.update(buildRewardRoleSearchPayload(interaction.guild, interaction.user.id, nivel, page));
        return true;
    }

    if (id === "paneladmin_levels_reward_add_manual") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_reward_add_manual_modal", "Añadir recompensa por ID", [
                { id: "nivel", label: "Nivel", placeholder: "30" },
                { id: "role_id", label: "Rol (mención o ID)", placeholder: "<@&123...> o 123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_user_adjust") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_user_adjust_modal", "Ajustar XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
                { id: "amount", label: "Cantidad (+ o -)", placeholder: "150 o -200" },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_user_reset") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_user_reset_modal", "Reset XP", [{ id: "user_id", label: "ID usuario", placeholder: "123..." }]),
        );
        return true;
    }

    if (id === "paneladmin_levels_user_view") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_user_view_modal", "Ver perfil XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_user_mult") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_user_mult_modal", "Multiplicador de coste XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
                { id: "multiplier", label: "Multiplicador (1 = normal, 0 quita el override)", placeholder: "1" },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_ignored_add") {
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("paneladmin_levels_ignored_add_select")
                .setPlaceholder("Selecciona canal")
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
        );
        await interaction.reply({ content: "Selecciona canal a ignorar:", components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_ignored_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_levels_ignored_remove_modal", "Quitar canal ignorado", [
                { id: "channel_id", label: "ID canal", placeholder: "123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_levels_ignored_clear") {
        xp.clearIgnoredChannels(guildId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.ignored.clear" });
        await interaction.reply({ content: "✅ Canales ignorados limpiados.", ephemeral: true });
        return true;
    }

    if (id.startsWith("paneladmin_levels_confirm_reset_")) {
        const userId = id.replace("paneladmin_levels_confirm_reset_", "");
        xp.resetUser(guildId, userId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.reset", details: { userId } });
        await interaction.update({
            embeds: [new EmbedBuilder().setTitle("✅ XP reseteada").setDescription(`<@${userId}> reseteado.`).setColor(0x2ecc40)],
            components: [],
        });
        return true;
    }

    return false;
}

async function handleLevelsModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_cfg_msg_modal") {
        const base = Math.max(1, parseInt(interaction.fields.getTextInputValue("xp_base"), 10));
        const bonus = Math.max(0, parseInt(interaction.fields.getTextInputValue("xp_bonus"), 10));
        const cd = Math.max(0, parseInt(interaction.fields.getTextInputValue("xp_cd"), 10));
        xp.setConfig(guildId, "xp_message_base", base);
        xp.setConfig(guildId, "xp_message_len_bonus_max", bonus);
        xp.setConfig(guildId, "xp_message_cooldown_sec", cd);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.messages" });
        await interaction.reply({ content: "✅ Config mensajes actualizada.", ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_voice_modal") {
        xp.setConfig(guildId, "xp_voice_per_min", Math.max(0, parseFloat(interaction.fields.getTextInputValue("xp_voice"))));
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.voice" });
        await interaction.reply({ content: "✅ XP voz actualizada.", ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_mult_modal") {
        const mult = Math.max(0, parseFloat(interaction.fields.getTextInputValue("xp_mult")));
        xp.setConfig(guildId, "xp_multiplier", mult);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.config.multiplier", details: { mult } });
        await interaction.reply({ content: `✅ Multiplicador x${mult}.`, ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_formula_modal") {
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
        await interaction.reply({ content: `✅ Fórmula ${base} × (N+1)^${exp} × ${costMult} × ${reqMult}.`, ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_cfg_streak_modal") {
        const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
        const enabled = !["no", "n", "0", "false"].includes(enabledRaw);
        const pctPerDay = Math.max(0, parseFloat(interaction.fields.getTextInputValue("pct_per_day")));
        const capPct = Math.max(0, parseFloat(interaction.fields.getTextInputValue("cap_pct")));
        if (isNaN(pctPerDay) || isNaN(capPct)) {
            await interaction.reply({ content: "Valores inválidos.", ephemeral: true });
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
            ephemeral: true,
        });
        return true;
    }

    if (id === "paneladmin_levels_reward_add_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        if (isNaN(nivel) || nivel < 1) {
            await interaction.reply({ content: "Nivel inválido.", ephemeral: true });
            return true;
        }
        const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(`paneladmin_levels_reward_role_${nivel}`)
                .setPlaceholder(`Selecciona rol para LVL ${nivel}`)
                .setMinValues(1)
                .setMaxValues(1),
        );
        await interaction.reply({ content: `Selecciona rol para LVL ${nivel}:`, components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_reward_desc_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const roleId = interaction.fields
            .getTextInputValue("role_id")
            .trim()
            .replace(/[<@&>]/g, "");
        const emoji = interaction.fields.getTextInputValue("emoji").trim().slice(0, 16);
        const descripcion = interaction.fields.getTextInputValue("descripcion").trim().slice(0, 200);
        if (!xp.setRewardDescription(guildId, nivel, roleId, descripcion, emoji)) {
            await interaction.reply({
                content: `❌ No hay ninguna recompensa con el rol ${roleId} en el nivel ${nivel}.`,
                ephemeral: true,
            });
            return true;
        }
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "xp.reward.description",
            details: { nivel, roleId, emoji, descripcion },
        });
        await interaction.reply({
            content: descripcion
                ? `✅ LVL ${nivel} · <@&${roleId}> — ${emoji || "🔓"} ${descripcion}`
                : `✅ Descripción quitada: <@&${roleId}> se muestra como rango.`,
            ephemeral: true,
        });
        return true;
    }

    if (id === "paneladmin_levels_reward_remove_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const rawRole = interaction.fields.getTextInputValue("role_id").trim();
        if (isNaN(nivel) || nivel < 1) {
            await interaction.reply({ content: "Nivel inválido.", ephemeral: true });
            return true;
        }

        let roleId = null;
        if (rawRole) {
            roleId = rawRole.replace(/[<@&>\s]/g, "");
            if (!/^\d{17,20}$/.test(roleId)) {
                await interaction.reply({
                    content: "Rol inválido. Usa mención o ID numérico, o déjalo vacío para quitar todos.",
                    ephemeral: true,
                });
                return true;
            }
        }

        xp.removeReward(guildId, nivel, roleId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.reward.remove", details: { nivel, roleId } });
        await interaction.reply({
            content: roleId ? `✅ Recompensa <@&${roleId}> quitada en LVL ${nivel}.` : `✅ Todas las recompensas de LVL ${nivel} quitadas.`,
            ephemeral: true,
        });
        return true;
    }

    if (id === "paneladmin_levels_reward_search_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const query = interaction.fields.getTextInputValue("query").trim().toLowerCase();
        if (isNaN(nivel) || nivel < 1 || !query) {
            await interaction.reply({ content: "Datos inválidos.", ephemeral: true });
            return true;
        }
        const roles = [...interaction.guild.roles.cache.values()]
            .filter((r) => !r.name.startsWith("@"))
            .sort((a, b) => b.position - a.position)
            .filter((r) => r.name.toLowerCase().includes(query));

        const key = `${interaction.guildId}:${interaction.user.id}:${nivel}`;
        rewardSearchSessions.set(key, { query, roleIds: roles.map((r) => r.id), createdAt: Date.now() });
        await interaction.reply(buildRewardRoleSearchPayload(interaction.guild, interaction.user.id, nivel, 0));
        return true;
    }

    if (id === "paneladmin_levels_reward_add_manual_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const rawRole = interaction.fields.getTextInputValue("role_id").trim();
        if (isNaN(nivel) || nivel < 1) {
            await interaction.reply({ content: "Nivel inválido.", ephemeral: true });
            return true;
        }

        const roleId = rawRole.replace(/[<@&>\s]/g, "");
        if (!/^\d{17,20}$/.test(roleId)) {
            await interaction.reply({ content: "Rol inválido. Usa mención o ID numérico.", ephemeral: true });
            return true;
        }

        const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
        if (!role) {
            await interaction.reply({ content: "No encontré ese rol en este servidor.", ephemeral: true });
            return true;
        }

        xp.setReward(interaction.guildId, nivel, role.id, role.name || "");
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.reward.set", details: { nivel, roleId: role.id } });
        await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${role.id}>`, ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_user_adjust_modal") {
        const userId = interaction.fields.getTextInputValue("user_id").trim();
        const amount = parseInt(interaction.fields.getTextInputValue("amount"), 10);
        if (!/^\d{17,19}$/.test(userId) || isNaN(amount)) {
            await interaction.reply({ content: "ID o cantidad inválida.", ephemeral: true });
            return true;
        }
        await xp.adjustUserXp(interaction.guild, userId, amount);
        const p = xp.getProfile(guildId, userId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.adjust", details: { userId, amount } });
        await interaction.reply({ content: `✅ XP ajustada. LVL ${p.nivel}, total ${p.xp_total}.`, ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_user_reset_modal") {
        const userId = interaction.fields.getTextInputValue("user_id").trim();
        if (!/^\d{17,19}$/.test(userId)) {
            await interaction.reply({ content: "ID inválido.", ephemeral: true });
            return true;
        }
        const embed = new EmbedBuilder()
            .setTitle("¿Confirmar reseteo de XP?")
            .setDescription(`Esto borra el nivel, XP y racha de <@${userId}> de forma irreversible.`)
            .setColor(0xffa500);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`paneladmin_levels_confirm_reset_${userId}`).setLabel("✅ Sí").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_cancel").setLabel("❌ Cancelar").setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_user_view_modal") {
        const userId = interaction.fields.getTextInputValue("user_id").trim();
        if (!/^\d{17,19}$/.test(userId)) {
            await interaction.reply({ content: "ID inválido.", ephemeral: true });
            return true;
        }
        const p = xp.getProfile(guildId, userId);
        const mult = xp.getUserCostMultiplier(guildId, userId);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("👤 Perfil XP")
                    .setDescription(`<@${userId}>\n**LVL ${p.nivel}**`)
                    .addFields(
                        { name: "XP nivel", value: `${p.xp}/${p.xp_need}`, inline: true },
                        { name: "XP total", value: `${p.xp_total}`, inline: true },
                        { name: "Ranking", value: `#${p.rank}`, inline: true },
                        { name: "Multiplicador de coste", value: `x${mult}`, inline: true },
                    )
                    .setColor(0x4a90e2),
            ],
            ephemeral: true,
        });
        return true;
    }

    if (id === "paneladmin_levels_user_mult_modal") {
        const userId = interaction.fields.getTextInputValue("user_id").trim();
        const multiplier = parseFloat(interaction.fields.getTextInputValue("multiplier"));
        if (!/^\d{17,19}$/.test(userId) || isNaN(multiplier) || multiplier < 0) {
            await interaction.reply({ content: "ID o multiplicador inválido.", ephemeral: true });
            return true;
        }
        if (multiplier === 0 || multiplier === 1) {
            xp.removeUserCostMultiplier(guildId, userId);
            adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.multiplier.clear", details: { userId } });
            await interaction.reply({ content: `✅ Multiplicador de <@${userId}> restablecido a x1.`, ephemeral: true });
            return true;
        }
        xp.setUserCostMultiplier(guildId, userId, multiplier);
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "xp.user.multiplier.set",
            details: { userId, multiplier },
        });
        await interaction.reply({ content: `✅ Multiplicador de coste de <@${userId}> ajustado a x${multiplier}.`, ephemeral: true });
        return true;
    }

    if (id === "paneladmin_levels_ignored_remove_modal") {
        const channelId = interaction.fields.getTextInputValue("channel_id").trim();
        if (!/^\d{17,19}$/.test(channelId)) {
            await interaction.reply({ content: "ID canal inválido.", ephemeral: true });
            return true;
        }
        xp.removeIgnoredChannel(guildId, channelId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.ignored.remove", details: { channelId } });
        await interaction.reply({ content: "✅ Canal quitado de ignorados.", ephemeral: true });
        return true;
    }

    return false;
}

async function handleRoleSelect(interaction) {
    if (!interaction.customId.startsWith("paneladmin_levels_reward_role_")) return false;
    const nivel = parseInt(interaction.customId.replace("paneladmin_levels_reward_role_", ""), 10);
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    xp.setReward(interaction.guildId, nivel, roleId, role?.name || "");
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "xp.reward.set",
        details: { nivel, roleId },
    });
    await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${roleId}>`, ephemeral: true });
    return true;
}

async function handleStringSelect(interaction) {
    if (!interaction.customId.startsWith("paneladmin_levels_reward_search_pick_")) return false;
    const nivel = parseInt(interaction.customId.replace("paneladmin_levels_reward_search_pick_", ""), 10);
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    xp.setReward(interaction.guildId, nivel, roleId, role?.name || "");
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "xp.reward.set",
        details: { nivel, roleId, via: "search" },
    });
    await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${roleId}>`, ephemeral: true });
    return true;
}

async function handleChannelSelect(interaction) {
    if (interaction.customId === "paneladmin_levels_cfg_channel_select") {
        const channelId = interaction.values[0];
        xp.setConfig(interaction.guildId, "xp_announce_channel_id", channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "xp.config.announce_channel",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal anuncio: <#${channelId}>`, ephemeral: true });
        return true;
    }

    if (interaction.customId === "paneladmin_levels_ignored_add_select") {
        const channelId = interaction.values[0];
        const ch = interaction.guild.channels.cache.get(channelId);
        xp.addIgnoredChannel(interaction.guildId, channelId, ch?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "xp.ignored.add",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal ignorado: <#${channelId}>`, ephemeral: true });
        return true;
    }

    return false;
}

module.exports = { handleLevelsButton, handleLevelsModal, handleRoleSelect, handleStringSelect, handleChannelSelect };
