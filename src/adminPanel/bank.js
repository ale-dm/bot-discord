const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, MessageFlags } = require("discord.js");
const db = require("../core/db");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

async function accionModificar(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("paneladmin_bank_modificar_select")
            .setPlaceholder("Selecciona usuario")
            .setMinValues(1)
            .setMaxValues(1),
    );
    await interaction.reply({ content: "Selecciona el usuario a modificar:", components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionResetear(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("paneladmin_bank_resetear_select")
            .setPlaceholder("Selecciona usuario")
            .setMinValues(1)
            .setMaxValues(1),
    );
    await interaction.reply({ content: "Selecciona el usuario a resetear:", components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionBorrarhistorial(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("paneladmin_bank_borrarhistorial_select")
            .setPlaceholder("Selecciona usuario")
            .setMinValues(1)
            .setMaxValues(1),
    );
    await interaction.reply({
        content: "Selecciona el usuario cuyo historial quieres borrar:",
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function accionBuscarusuario(interaction, id, guildId) {
    const modal = simpleModal("paneladmin_bank_buscarusuario_modal", "Buscar usuario", [
        { id: "busqueda_usuario", label: "Nombre/tag o ID", placeholder: "Alex#1234 o 123..." },
    ]);
    await interaction.showModal(modal);
    return true;
}

async function accionHistorialglobal(interaction, id, guildId) {
    let page = 0;
    if (id.startsWith("paneladmin_bank_historialglobal_page_")) page = parseInt(id.split("_").pop(), 10) || 0;
    const pageSize = 10;
    const offset = page * pageSize;
    const historial = db
        .prepare("SELECT userId, fecha, descripcion, cantidad FROM historial ORDER BY fecha DESC LIMIT ? OFFSET ?")
        .all(pageSize, offset);
    const total = db.prepare("SELECT COUNT(*) AS total FROM historial").get().total || 0;
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

    const lines = historial.length
        ? historial
              .map((h) => {
                  const emoji = h.cantidad > 0 ? "🟢" : "🔴";
                  const cant = h.cantidad > 0 ? `+${h.cantidad}` : `${h.cantidad}`;
                  return `${emoji} **${cant}** — <@${h.userId}> — ${h.descripcion}`;
              })
              .join("\n")
        : "Sin movimientos.";

    const embed = new EmbedBuilder()
        .setTitle("📜 Historial global")
        .setDescription(lines)
        .setFooter({ text: `Página ${page + 1}/${maxPage + 1}` })
        .setColor(0x8e44ad);
    const btns = [];
    if (page > 0)
        btns.push(
            new ButtonBuilder()
                .setCustomId(`paneladmin_bank_historialglobal_page_${page - 1}`)
                .setLabel("⏮️")
                .setStyle(ButtonStyle.Secondary),
        );
    if (page < maxPage)
        btns.push(
            new ButtonBuilder()
                .setCustomId(`paneladmin_bank_historialglobal_page_${page + 1}`)
                .setLabel("⏭️")
                .setStyle(ButtonStyle.Secondary),
        );
    const components = btns.length ? [new ActionRowBuilder().addComponents(...btns)] : [];

    if (id === "paneladmin_bank_historialglobal") await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    else await interaction.update({ embeds: [embed], components });
    return true;
}

async function accionConfirmReset(interaction, id, guildId) {
    const userId = id.replace("paneladmin_bank_confirm_reset_", "");
    // Como una cuenta nueva: el dinero inicial en efectivo, banco vacío y sin dinero negro.
    db.prepare("UPDATE banco SET saldo = 0, enMano = ?, negro = 0 WHERE userId = ?").run(require("../systems/dinero").INICIAL, userId);
    require("../systems/dinero").apuntar(userId, "admin", "Reseteo admin", 0);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "bank.user.reset",
        details: { userId },
    });
    await interaction.update({
        embeds: [new EmbedBuilder().setTitle("✅ Usuario reseteado").setDescription(`<@${userId}> reseteado.`).setColor(0x2ecc40)],
        components: [],
    });
    return true;
}

async function accionConfirmBorrar(interaction, id, guildId) {
    const userId = id.replace("paneladmin_bank_confirm_borrar_", "");
    db.prepare("DELETE FROM historial WHERE userId = ?").run(userId);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "bank.history.clear",
        details: { userId },
    });
    await interaction.update({
        embeds: [
            new EmbedBuilder().setTitle("🗑️ Historial borrado").setDescription(`Historial de <@${userId}> eliminado.`).setColor(0xe74c3c),
        ],
        components: [],
    });
    return true;
}

async function accionPaneladminCancel(interaction, id, guildId) {
    await interaction.update({ embeds: [new EmbedBuilder().setTitle("❌ Acción cancelada").setColor(0x95a5a6)], components: [] });
    return true;
}

const ACCIONES_BANCO = [
    [(id) => id === "paneladmin_bank_modificar", accionModificar],
    [(id) => id === "paneladmin_bank_resetear", accionResetear],
    [(id) => id === "paneladmin_bank_borrarhistorial", accionBorrarhistorial],
    [(id) => id === "paneladmin_bank_buscarusuario", accionBuscarusuario],
    [(id) => id === "paneladmin_bank_historialglobal" || id.startsWith("paneladmin_bank_historialglobal_page_"), accionHistorialglobal],
    [(id) => id.startsWith("paneladmin_bank_confirm_reset_"), accionConfirmReset],
    [(id) => id.startsWith("paneladmin_bank_confirm_borrar_"), accionConfirmBorrar],
    [(id) => id === "paneladmin_cancel", accionPaneladminCancel],
];

async function handleBankButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    for (const [encaja, accion] of ACCIONES_BANCO) {
        if (encaja(id)) return accion(interaction, id, guildId);
    }
    return false;
}

// Suma la cantidad al destino elegido (efectivo, banco o dinero negro) y lo deja en el historial y en el registro de admin.
async function modificarSaldo(interaction, userId) {
    const cantidad = parseInt(interaction.fields.getTextInputValue("cantidad"), 10);
    const tipo = interaction.fields.getTextInputValue("tipo");
    // "efectivo" (o el antiguo "enMano"), "banco" o "negro" (dinero negro, F-EC-06b).
    const destino = tipo.trim().toLowerCase();
    if (!["banco", "efectivo", "enmano", "negro"].includes(destino)) {
        await interaction.reply({ content: "Tipo inválido. Usa efectivo, banco o negro.", flags: MessageFlags.Ephemeral });
        return true;
    }
    require("../systems/dinero").asegurarCuenta(userId);
    if (destino === "banco") db.prepare("UPDATE banco SET saldo = saldo + ? WHERE userId = ?").run(cantidad, userId);
    else if (destino === "negro") db.prepare("UPDATE banco SET negro = negro + ? WHERE userId = ?").run(cantidad, userId);
    else db.prepare("UPDATE banco SET enMano = enMano + ? WHERE userId = ?").run(cantidad, userId);
    require("../systems/dinero").apuntar(userId, "admin", `Modificación admin (${tipo})`, cantidad);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "bank.balance.modify",
        details: { userId, tipo, cantidad },
    });
    await interaction.reply({ content: `✅ Saldo actualizado para <@${userId}>.`, flags: MessageFlags.Ephemeral });
    return true;
}

// Busca por ID (17-19 dígitos) o por tag/usuario, sin distinguir mayúsculas.
async function buscarMiembro(interaction, query) {
    if (/^\d{17,19}$/.test(query)) return interaction.guild.members.fetch(query).catch(() => null);
    const minusculas = query.toLowerCase();
    return (
        interaction.guild.members.cache.find(
            (m) => m.user.tag.toLowerCase() === minusculas || m.user.username.toLowerCase() === minusculas,
        ) || null
    );
}

function textoResumenBanco(memberId) {
    const datos = db.prepare("SELECT saldo, enMano, negro FROM banco WHERE userId = ?").get(memberId);
    const historial = db
        .prepare("SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? ORDER BY fecha DESC LIMIT 5")
        .all(memberId);
    let desc = datos
        ? `💵 Efectivo: **${datos.enMano}**\n🏦 Banco: **${datos.saldo}**\n🥷 Dinero negro: **${datos.negro || 0}**`
        : "Sin datos bancarios.";
    if (historial.length)
        desc +=
            "\n\nÚltimos movimientos:\n" +
            historial.map((h) => `• ${h.descripcion} (${h.cantidad > 0 ? "+" : ""}${h.cantidad})`).join("\n");
    return desc;
}

async function buscarUsuario(interaction) {
    const query = interaction.fields.getTextInputValue("busqueda_usuario").trim();
    const member = await buscarMiembro(interaction, query);
    if (!member) {
        await interaction.reply({ content: "Usuario no encontrado.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const desc = textoResumenBanco(member.id);
    await interaction.reply({
        embeds: [new EmbedBuilder().setTitle(`🔎 ${member.user.tag}`).setDescription(desc).setColor(0x2980b9)],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function handleBankModal(interaction) {
    const id = interaction.customId;
    if (id.startsWith("paneladmin_bank_modificar_modal_")) {
        return modificarSaldo(interaction, id.replace("paneladmin_bank_modificar_modal_", ""));
    }
    if (id === "paneladmin_bank_buscarusuario_modal") return buscarUsuario(interaction);
    return false;
}

async function handleBankUserSelect(interaction) {
    if (interaction.customId === "paneladmin_bank_modificar_select") {
        const userId = interaction.values[0];
        const modal = simpleModal(`paneladmin_bank_modificar_modal_${userId}`, "Modificar saldo", [
            { id: "cantidad", label: "Cantidad (+ o -)", placeholder: "100 o -50" },
            { id: "tipo", label: "Destino (efectivo, banco o negro)", placeholder: "efectivo / banco / negro" },
        ]);
        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId === "paneladmin_bank_resetear_select") {
        const userId = interaction.values[0];
        const embed = new EmbedBuilder().setTitle("¿Confirmar reseteo?").setDescription(`¿Resetear a <@${userId}>?`).setColor(0xffa500);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`paneladmin_bank_confirm_reset_${userId}`).setLabel("✅ Sí").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_cancel").setLabel("❌ Cancelar").setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === "paneladmin_bank_borrarhistorial_select") {
        const userId = interaction.values[0];
        const embed = new EmbedBuilder()
            .setTitle("¿Confirmar borrado?")
            .setDescription(`¿Borrar historial de <@${userId}>?`)
            .setColor(0xffa500);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`paneladmin_bank_confirm_borrar_${userId}`).setLabel("✅ Sí").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("paneladmin_cancel").setLabel("❌ Cancelar").setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { handleBankButton, handleBankModal, handleBankUserSelect };
