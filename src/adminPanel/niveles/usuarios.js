// Panel admin → Niveles → 👤 Usuarios: ajustar, consultar o resetear la XP de alguien y su
// multiplicador de coste.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");

// Los formularios que abren los botones de la vista de usuarios.
const MODALES_USUARIOS = new Map([
    [
        "paneladmin_levels_user_adjust",
        () =>
            simpleModal("paneladmin_levels_user_adjust_modal", "Ajustar XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
                { id: "amount", label: "Cantidad (+ o -)", placeholder: "150 o -200" },
            ]),
    ],
    [
        "paneladmin_levels_user_reset",
        () =>
            simpleModal("paneladmin_levels_user_reset_modal", "Reset XP", [{ id: "user_id", label: "ID usuario", placeholder: "123..." }]),
    ],
    [
        "paneladmin_levels_user_view",
        () =>
            simpleModal("paneladmin_levels_user_view_modal", "Ver perfil XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
            ]),
    ],
    [
        "paneladmin_levels_user_mult",
        () =>
            simpleModal("paneladmin_levels_user_mult_modal", "Multiplicador de coste XP", [
                { id: "user_id", label: "ID usuario", placeholder: "123..." },
                { id: "multiplier", label: "Multiplicador (1 = normal, 0 quita)", placeholder: "1" },
            ]),
    ],
]);

async function vistaUsuarios(interaction) {
    const embed = new EmbedBuilder().setTitle("👤 Gestión XP usuarios").setDescription("Ajusta, consulta o resetea XP.").setColor(0xe17055);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_levels_user_adjust").setLabel("± XP usuario").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_levels_user_reset").setLabel("Reset XP").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_levels_user_view").setLabel("Ver perfil").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_user_mult").setLabel("⚙️ Multiplicador usuario").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_levels_home").setLabel("◀ Niveles").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return true;
}

async function confirmarReset(interaction, id) {
    const guildId = interaction.guildId;
    const userId = id.replace("paneladmin_levels_confirm_reset_", "");
    xp.resetUser(guildId, userId);
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.reset", details: { userId } });
    await interaction.update({
        embeds: [new EmbedBuilder().setTitle("✅ XP reseteada").setDescription(`<@${userId}> reseteado.`).setColor(0x2ecc40)],
        components: [],
    });
    return true;
}

async function boton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_levels_users") return vistaUsuarios(interaction);
    const crearModal = MODALES_USUARIOS.get(id);
    if (crearModal) {
        await interaction.showModal(crearModal());
        return true;
    }
    if (id.startsWith("paneladmin_levels_confirm_reset_")) return confirmarReset(interaction, id);
    return false;
}

async function modalAjustar(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.fields.getTextInputValue("user_id").trim();
    const amount = parseInt(interaction.fields.getTextInputValue("amount"), 10);
    if (!/^\d{17,19}$/.test(userId) || isNaN(amount)) {
        await interaction.reply({ content: "ID o cantidad inválida.", flags: MessageFlags.Ephemeral });
        return true;
    }
    await xp.adjustUserXp(interaction.guild, userId, amount);
    const p = xp.getProfile(guildId, userId);
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.adjust", details: { userId, amount } });
    await interaction.reply({ content: `✅ XP ajustada. LVL ${p.nivel}, total ${p.xp_total}.`, flags: MessageFlags.Ephemeral });
    return true;
}

async function modalConfirmarReset(interaction) {
    const userId = interaction.fields.getTextInputValue("user_id").trim();
    if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({ content: "ID inválido.", flags: MessageFlags.Ephemeral });
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
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

async function modalVerPerfil(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.fields.getTextInputValue("user_id").trim();
    if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({ content: "ID inválido.", flags: MessageFlags.Ephemeral });
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
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function modalMultiplicador(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.fields.getTextInputValue("user_id").trim();
    const multiplier = parseFloat(interaction.fields.getTextInputValue("multiplier"));
    if (!/^\d{17,19}$/.test(userId) || isNaN(multiplier) || multiplier < 0) {
        await interaction.reply({ content: "ID o multiplicador inválido.", flags: MessageFlags.Ephemeral });
        return true;
    }
    if (multiplier === 0 || multiplier === 1) {
        xp.removeUserCostMultiplier(guildId, userId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "xp.user.multiplier.clear", details: { userId } });
        await interaction.reply({ content: `✅ Multiplicador de <@${userId}> restablecido a x1.`, flags: MessageFlags.Ephemeral });
        return true;
    }
    // Lo que se guarda puede ser distinto de lo pedido (mínimo 0.01): se enseña lo guardado.
    const guardado = xp.setUserCostMultiplier(guildId, userId, multiplier);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "xp.user.multiplier.set",
        details: { userId, multiplier: guardado },
    });
    await interaction.reply({
        content: `✅ Multiplicador de coste de <@${userId}> ajustado a x${guardado}.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function modal(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_levels_user_adjust_modal") return modalAjustar(interaction);
    if (id === "paneladmin_levels_user_reset_modal") return modalConfirmarReset(interaction);
    if (id === "paneladmin_levels_user_view_modal") return modalVerPerfil(interaction);
    if (id === "paneladmin_levels_user_mult_modal") return modalMultiplicador(interaction);
    return false;
}

module.exports = { boton, modal };
