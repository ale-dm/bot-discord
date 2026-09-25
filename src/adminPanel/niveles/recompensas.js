// Panel admin → Niveles → 🎭 Recompensas: roles que se dan al llegar a un nivel (por selector, por
// búsqueda de nombre o por ID) y su descripción.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");

const rewardSearchSessions = new Map();

function buildRewardRoleSearchPayload(guild, userId, nivel, page = 0) {
    const key = `${guild.id}:${userId}:${nivel}`;
    const session = rewardSearchSessions.get(key);
    if (!session) {
        return { content: "Sesión caducada. Repite la búsqueda.", components: [], flags: MessageFlags.Ephemeral };
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
        return { content: `No encontré roles para "${session.query}"`, components: rows, flags: MessageFlags.Ephemeral };
    }

    return {
        content: `Resultados para "${session.query}" (LVL ${nivel})`,
        components: rows,
        flags: MessageFlags.Ephemeral,
    };
}

async function boton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

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
        // Al editar no se mandan los flags (el mensaje ya es privado; lo privado no se puede cambiar).
        const { flags: _flags, ...payload } = buildRewardRoleSearchPayload(interaction.guild, interaction.user.id, nivel, page);
        await interaction.update(payload);
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

    return false;
}

async function modal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_reward_add_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        if (isNaN(nivel) || nivel < 1) {
            await interaction.reply({ content: "Nivel inválido.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(`paneladmin_levels_reward_role_${nivel}`)
                .setPlaceholder(`Selecciona rol para LVL ${nivel}`)
                .setMinValues(1)
                .setMaxValues(1),
        );
        await interaction.reply({ content: `Selecciona rol para LVL ${nivel}:`, components: [row], flags: MessageFlags.Ephemeral });
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
                flags: MessageFlags.Ephemeral,
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
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (id === "paneladmin_levels_reward_remove_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const rawRole = interaction.fields.getTextInputValue("role_id").trim();
        if (isNaN(nivel) || nivel < 1) {
            await interaction.reply({ content: "Nivel inválido.", flags: MessageFlags.Ephemeral });
            return true;
        }

        let roleId = null;
        if (rawRole) {
            roleId = rawRole.replace(/[<@&>\s]/g, "");
            if (!/^\d{17,20}$/.test(roleId)) {
                await interaction.reply({
                    content: "Rol inválido. Usa mención o ID numérico, o déjalo vacío para quitar todos.",
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }
        }

        xp.removeReward(guildId, nivel, roleId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.reward.remove", details: { nivel, roleId } });
        await interaction.reply({
            content: roleId ? `✅ Recompensa <@&${roleId}> quitada en LVL ${nivel}.` : `✅ Todas las recompensas de LVL ${nivel} quitadas.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (id === "paneladmin_levels_reward_search_modal") {
        const nivel = parseInt(interaction.fields.getTextInputValue("nivel"), 10);
        const query = interaction.fields.getTextInputValue("query").trim().toLowerCase();
        if (isNaN(nivel) || nivel < 1 || !query) {
            await interaction.reply({ content: "Datos inválidos.", flags: MessageFlags.Ephemeral });
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
            await interaction.reply({ content: "Nivel inválido.", flags: MessageFlags.Ephemeral });
            return true;
        }

        const roleId = rawRole.replace(/[<@&>\s]/g, "");
        if (!/^\d{17,20}$/.test(roleId)) {
            await interaction.reply({ content: "Rol inválido. Usa mención o ID numérico.", flags: MessageFlags.Ephemeral });
            return true;
        }

        const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
        if (!role) {
            await interaction.reply({ content: "No encontré ese rol en este servidor.", flags: MessageFlags.Ephemeral });
            return true;
        }

        xp.setReward(interaction.guildId, nivel, role.id, role.name || "");
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.reward.set", details: { nivel, roleId: role.id } });
        await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${role.id}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function selectRol(interaction) {
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
    await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${roleId}>`, flags: MessageFlags.Ephemeral });
    return true;
}

async function selectTexto(interaction) {
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
    await interaction.reply({ content: `✅ Recompensa guardada: LVL ${nivel} → <@&${roleId}>`, flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { boton, modal, selectRol, selectTexto };
