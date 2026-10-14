// Panel admin → Niveles → 🚫 Ignorados: dónde y quién no gana XP (canales y roles ignorados) y los multiplicadores de XP por canal.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { modalConCampos, simpleModal, canalElegido, rolElegido } = require("../common");

const MULTIPLICADOR_MAX = 10;
const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });

const boton = (id, label, estilo = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(estilo);

function pantallaIgnorados(guildId) {
    const canales = xp.getIgnoredChannels(guildId).map((c) => `• <#${c.channelId}>`);
    const roles = xp.getIgnoredRoles(guildId).map((r) => `• <@&${r.roleId}>`);
    const multiplicadores = xp.getMultiplicadoresCanal(guildId).map((m) => `• <#${m.channelId}> ×${m.multiplicador}`);
    const embed = new EmbedBuilder()
        .setTitle("🚫 Canales y roles ignorados · multiplicadores de XP")
        .addFields(
            { name: "Canales ignorados", value: canales.join("\n") || "Ninguno.", inline: false },
            { name: "Roles sin XP", value: roles.join("\n") || "Ninguno.", inline: false },
            { name: "Multiplicador por canal", value: multiplicadores.join("\n") || "Ninguno (todos ×1).", inline: false },
        )
        .setColor(0x636e72);
    const fila1 = new ActionRowBuilder().addComponents(
        boton("paneladmin_levels_ignored_add", "➕ Ignorar canal", ButtonStyle.Primary),
        boton("paneladmin_levels_ignored_remove", "➖ Quitar"),
        boton("paneladmin_levels_ignored_clear", "🧹 Limpiar", ButtonStyle.Danger),
    );
    const fila2 = new ActionRowBuilder().addComponents(
        boton("paneladmin_levels_ignored_role_add", "🎭 Rol sin XP", ButtonStyle.Primary),
        boton("paneladmin_levels_ignored_role_remove", "🎭 Quitar rol"),
        boton("paneladmin_levels_ignored_mult", "✖️ Multiplicador de canal", ButtonStyle.Primary),
        boton("paneladmin_levels_home", "◀ Niveles"),
    );
    return { embeds: [embed], components: [fila1, fila2] };
}

async function pedirCanal(interaction, customId, texto) {
    const fila = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder("Selecciona canal")
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
    );
    await interaction.reply({ content: texto, components: [fila], flags: MessageFlags.Ephemeral });
}

const ACCIONES = {
    paneladmin_levels_ignored: (interaction) => interaction.update(pantallaIgnorados(interaction.guildId)),
    paneladmin_levels_ignored_add: (interaction) =>
        pedirCanal(interaction, "paneladmin_levels_ignored_add_select", "Selecciona canal a ignorar:"),
    paneladmin_levels_ignored_remove: (interaction) =>
        interaction.showModal(
            modalConCampos("paneladmin_levels_ignored_remove_modal", "Quitar canal ignorado", [
                { id: "channel_id", label: "Canal a quitar", tipo: "canal" },
            ]),
        ),
    paneladmin_levels_ignored_clear: (interaction) => {
        xp.clearIgnoredChannels(interaction.guildId);
        adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: "xp.ignored.clear" });
        return interaction.reply(efimero("✅ Canales ignorados limpiados."));
    },
    paneladmin_levels_ignored_role_add: (interaction) => {
        const fila = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId("paneladmin_levels_ignored_role_select")
                .setPlaceholder("Selecciona rol")
                .setMinValues(1)
                .setMaxValues(1),
        );
        return interaction.reply({
            content: "Quien tenga este rol no ganará XP (texto ni voz):",
            components: [fila],
            flags: MessageFlags.Ephemeral,
        });
    },
    paneladmin_levels_ignored_role_remove: (interaction) =>
        interaction.showModal(
            modalConCampos("paneladmin_levels_ignored_role_remove_modal", "Quitar rol sin XP", [
                { id: "role_id", label: "Rol a quitar", tipo: "rol" },
            ]),
        ),
    paneladmin_levels_ignored_mult: (interaction) =>
        pedirCanal(interaction, "paneladmin_levels_mult_select", "Selecciona el canal al que ponerle multiplicador de XP:"),
};

async function botonIgnorados(interaction) {
    const accion = ACCIONES[interaction.customId];
    if (!accion) return false;
    await accion(interaction);
    return true;
}

/** "1,5" o "1.5" → 1.5; null si no es un número entre 0 y MULTIPLICADOR_MAX. */
function leerMultiplicador(texto) {
    const n = Number(String(texto).trim().replace(",", "."));
    return String(texto).trim() !== "" && Number.isFinite(n) && n >= 0 && n <= MULTIPLICADOR_MAX ? Math.round(n * 100) / 100 : null;
}

async function modal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const actorId = interaction.user.id;

    if (id === "paneladmin_levels_ignored_remove_modal") {
        const channelId = canalElegido(interaction.fields, "channel_id");
        if (!channelId) return (interaction.reply(efimero("Elige un canal.")), true);
        xp.removeIgnoredChannel(guildId, channelId);
        adminAudit.logAdminAction({ guildId, actorId, action: "xp.ignored.remove", details: { channelId } });
        await interaction.reply(efimero("✅ Canal quitado de ignorados."));
        return true;
    }

    if (id === "paneladmin_levels_ignored_role_remove_modal") {
        const roleId = rolElegido(interaction.fields, "role_id");
        if (!roleId) return (interaction.reply(efimero("Elige un rol.")), true);
        const quitado = xp.removeIgnoredRole(guildId, roleId);
        if (quitado) adminAudit.logAdminAction({ guildId, actorId, action: "xp.ignored_role.remove", details: { roleId } });
        await interaction.reply(efimero(quitado ? "✅ Rol quitado: vuelve a ganar XP." : "Ese rol no estaba en la lista."));
        return true;
    }

    const mult = /^paneladmin_levels_mult_modal_(\d+)$/.exec(id);
    if (mult) {
        const multiplicador = leerMultiplicador(interaction.fields.getTextInputValue("multiplicador"));
        if (multiplicador === null) {
            await interaction.reply(efimero(`Valor inválido: un número entre 0 y ${MULTIPLICADOR_MAX} (1 = normal, 0 = canal ignorado).`));
            return true;
        }
        xp.setMultiplicadorCanal(guildId, mult[1], multiplicador);
        adminAudit.logAdminAction({ guildId, actorId, action: "xp.channel_multiplier", details: { channelId: mult[1], multiplicador } });
        await interaction.reply(
            efimero(multiplicador === 1 ? `✅ <#${mult[1]}> vuelve a ×1.` : `✅ <#${mult[1]}> da ×${multiplicador} de XP.`),
        );
        return true;
    }

    return false;
}

async function selectCanal(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_levels_ignored_add_select") {
        const channelId = interaction.values[0];
        const ch = interaction.guild.channels.cache.get(channelId);
        xp.addIgnoredChannel(interaction.guildId, channelId, ch?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "xp.ignored.add",
            details: { channelId },
        });
        await interaction.reply(efimero(`✅ Canal ignorado: <#${channelId}>`));
        return true;
    }
    // El multiplicador se pide en un modal (se puede abrir desde un select): el canal va en su id.
    if (id === "paneladmin_levels_mult_select") {
        await interaction.showModal(
            simpleModal(`paneladmin_levels_mult_modal_${interaction.values[0]}`, "Multiplicador de XP del canal", [
                { id: "multiplicador", label: `Multiplicador (0 a ${MULTIPLICADOR_MAX}; 1 = normal)`, value: "1" },
            ]),
        );
        return true;
    }
    return false;
}

async function selectRol(interaction) {
    if (interaction.customId !== "paneladmin_levels_ignored_role_select") return false;
    const roleId = interaction.values[0];
    xp.addIgnoredRole(interaction.guildId, roleId, interaction.guild.roles.cache.get(roleId)?.name || "");
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "xp.ignored_role.add",
        details: { roleId },
    });
    await interaction.reply(efimero(`✅ <@&${roleId}> ya no gana XP.`));
    return true;
}

module.exports = { boton: botonIgnorados, modal, selectCanal, selectRol, pantallaIgnorados };
