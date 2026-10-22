// 🎭 /autoroles (F-AD-07, #539): menú de roles que cada persona se pone y se quita. La lista la configura
// un admin en Config Global → 🎭 Autoroles. Jerarquía, permisos y mantenimiento se comprueban al pulsar.
const { SlashCommandBuilder } = require("discord.js");
const autoroles = require("../../systems/autoroles");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { rolAsignable } = require("../../discord/rolesAutoroles");
const { buildAutoroles } = require("../../paneles/autoroles");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Autoroles");

function payload(interaction, aviso = null) {
    return buildAutoroles(autoroles.lista(interaction.guildId), {
        guild: interaction.guild,
        memberId: interaction.user.id,
        aviso,
    });
}

/** Comprueba que el rol existe, no lo gestiona una integración y está por debajo del bot. */
async function alternar(interaction, roleId) {
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const filas = autoroles.lista(guildId);
    const fila = filas.find((r) => r.roleId === String(roleId));
    if (!fila) return interaction.update(payload(interaction, "❌ Ese rol ya no está en el menú."));
    if (guildSettings.getSettings(guildId).mantenimiento.activo) {
        return interaction.update(payload(interaction, "🛠️ El bot está en mantenimiento: ahora no se cambian roles."));
    }
    const check = rolAsignable(guild, fila.roleId);
    if (!check.ok) return interaction.update(payload(interaction, `❌ ${check.motivo}`));

    const member = interaction.member;
    const tiene = member.roles.cache.has(fila.roleId);
    try {
        if (tiene) {
            await member.roles.remove(fila.roleId);
        } else {
            // Grupo exclusivo (p. ej. colores): al ponerte uno, se quitan los otros del grupo.
            if (fila.grupo) {
                const otros = filas.filter((r) => r.grupo === fila.grupo && r.roleId !== fila.roleId && member.roles.cache.has(r.roleId));
                for (const otro of otros) await member.roles.remove(otro.roleId);
            }
            await member.roles.add(fila.roleId);
        }
    } catch (e) {
        log.warn(`No pude ${tiene ? "quitar" : "poner"} el rol ${fila.roleId} a ${interaction.user.id}: ${e.message}`);
        return interaction.update(payload(interaction, "❌ No pude cambiar el rol: revisa los permisos y la jerarquía del bot."));
    }

    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "autoroles.toggle",
        details: { roleId: fila.roleId, accion: tiene ? "quitado" : "puesto", ...(fila.grupo ? { grupo: fila.grupo } : {}) },
    });
    return interaction.update(
        payload(interaction, tiene ? `✅ Te has quitado **${check.role.name}**.` : `✅ Te has puesto **${check.role.name}**.`),
    );
}

module.exports = {
    data: new SlashCommandBuilder().setName("autoroles").setDescription("🎭 Ponte o quítate los roles del menú del servidor"),

    componentHandlers: [
        { types: ["button"], prefixes: ["autorol_btn_"], method: "handleButton", acl: "autoroles" },
        { types: ["stringSelect"], ids: ["autorol_sel"], method: "handleSelect", acl: "autoroles" },
    ],

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        return interaction.reply(efimero(payload(interaction)));
    },

    async handleButton(client, interaction) {
        if (!interaction.customId.startsWith("autorol_btn_")) return;
        return alternar(interaction, interaction.customId.replace("autorol_btn_", ""));
    },

    async handleSelect(client, interaction) {
        if (interaction.customId !== "autorol_sel") return;
        return alternar(interaction, interaction.values[0]);
    },
};
