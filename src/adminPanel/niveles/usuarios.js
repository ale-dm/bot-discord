// Panel admin → Niveles → 👤 Usuarios: ajustar, consultar o resetear la XP de alguien y su
// multiplicador de coste.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const xp = require("../../systems/xpSystem");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");

async function boton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

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

async function modal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_levels_user_adjust_modal") {
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

    if (id === "paneladmin_levels_user_reset_modal") {
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

    if (id === "paneladmin_levels_user_view_modal") {
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

    if (id === "paneladmin_levels_user_mult_modal") {
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
        xp.setUserCostMultiplier(guildId, userId, multiplier);
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "xp.user.multiplier.set",
            details: { userId, multiplier },
        });
        await interaction.reply({
            content: `✅ Multiplicador de coste de <@${userId}> ajustado a x${multiplier}.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    return false;
}

module.exports = { boton, modal };
