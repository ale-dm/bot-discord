// ⚙️ Config Global → 🎭 Autoroles (#539): los roles que aparecen en /autoroles, con etiqueta, emoji y grupo
// exclusivo. Aquí se añaden y se quitan; los permisos y la jerarquía se comprueban al guardar.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const autoroles = require("../../systems/autoroles");
const { rolAsignable } = require("../../discord/rolesAutoroles");
const { modalConCampos, rolesElegidos } = require("../common");
const { guardarAuditado } = require("./guardar");
const { navRow } = require("./vistas");

function buildAutorolesPanel(guildId) {
    const filas = autoroles.lista(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🎭 Autoroles")
        .setDescription(
            "Los roles de este menú aparecen en `/autoroles` y cada persona se los pone o se los quita. " +
                `Máximo **${autoroles.MAX}**. Si dos roles comparten **grupo**, solo se puede tener uno de ellos (por ejemplo, colores).`,
        )
        .addFields({
            name: "Roles en el menú",
            value: filas.length
                ? filas
                      .map(
                          (f, i) =>
                              `**${i + 1}.** ${f.emoji ? `${f.emoji} ` : ""}${f.etiqueta} (<@&${f.roleId}>)${f.grupo ? ` · grupo *${f.grupo}*` : ""}`,
                      )
                      .join("\n")
                : "Ninguno todavía.",
        })
        .setColor(0x5865f2);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("paneladmin_cfg_autoroles_add")
            .setLabel("➕ Añadir rol")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(filas.length >= autoroles.MAX),
        new ButtonBuilder()
            .setCustomId("paneladmin_cfg_autoroles_remove")
            .setLabel("➖ Quitar rol")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!filas.length),
    );
    return { embeds: [embed], components: [row, navRow()], allowedMentions: { parse: [] } };
}

async function abrirModalAnadir(interaction, guildId) {
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_autoroles_add_modal", "Añadir autorol", [
            { id: "rol", label: "Rol", tipo: "rol" },
            { id: "etiqueta", label: "Etiqueta (vacío = nombre del rol)", required: false, maxLength: autoroles.MAX_ETIQUETA },
            { id: "emoji", label: "Emoji (opcional)", required: false, maxLength: 8 },
            { id: "grupo", label: "Grupo exclusivo (opcional)", required: false, maxLength: autoroles.MAX_GRUPO },
        ]),
    );
    return true;
}

async function guardarAnadir(interaction, id, guildId) {
    const roleId = rolesElegidos(interaction.fields, "rol")[0];
    if (!roleId) {
        await interaction.reply({ content: "❌ Elige un rol.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const check = rolAsignable(interaction.guild, roleId);
    if (!check.ok) {
        await interaction.reply({ content: `❌ ${check.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const campo = (nombre) => String(interaction.fields.getTextInputValue(nombre) || "").trim();
    const r = autoroles.anadir(guildId, {
        roleId,
        etiqueta: campo("etiqueta") || check.role.name,
        emoji: campo("emoji"),
        grupo: campo("grupo"),
    });
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    guardarAuditado(guildId, interaction.user.id, "settings.autoroles.update", {
        "autoroles.lista": JSON.stringify(r.lista),
    });
    await interaction.reply({ content: `✅ **${check.role.name}** añadido al menú de autoroles.`, flags: MessageFlags.Ephemeral });
    return true;
}

async function abrirModalQuitar(interaction, guildId) {
    if (!autoroles.lista(guildId).length) {
        await interaction.reply({ content: "❌ No hay roles en el menú.", flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_autoroles_remove_modal", "Quitar autorol", [
            { id: "rol", label: "Rol a quitar del menú", tipo: "rol" },
        ]),
    );
    return true;
}

async function guardarQuitar(interaction, id, guildId) {
    const roleId = rolesElegidos(interaction.fields, "rol")[0];
    const r = roleId ? autoroles.quitar(guildId, roleId) : { ok: false, motivo: "Elige un rol." };
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    guardarAuditado(guildId, interaction.user.id, "settings.autoroles.update", {
        "autoroles.lista": JSON.stringify(r.lista),
    });
    await interaction.reply({ content: "✅ Rol quitado del menú de autoroles.", flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildAutorolesPanel, abrirModalAnadir, guardarAnadir, abrirModalQuitar, guardarQuitar };
