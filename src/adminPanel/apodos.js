// Panel admin → Config Global → Duende → Apodos: cómo llama el Duende a cada uno y de qué otras formas se
// refiere la gente a esa persona (ver systems/apodos.js).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, MessageFlags } = require("discord.js");
const apodos = require("../systems/apodos");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

function buildApodosHome(guildId) {
    const personas = apodos.porPersona(guildId);
    let lines = personas.length
        ? personas
              .map((p) => `• <@${p.discordId}> — **${p.nombre || "(sin nombre)"}**${p.apodos.length ? ` · ${p.apodos.join(", ")}` : ""}`)
              .join("\n")
        : "No hay apodos todavía.";
    if (lines.length > 3800) lines = lines.slice(0, 3800) + "\n…";

    const embed = new EmbedBuilder()
        .setTitle("🏷️ Apodos del Duende")
        .setDescription(
            "**Nombre** (en negrita): cómo llama el Duende a cada uno; si lo escribe en una respuesta, lo convierte en mención.\n" +
                "**Apodos**: otras formas de referirse a esa persona. Sirven para que entienda de quién habláis " +
                '("¿qué ha visto el perro?") pero no generan menciones.\n\n' +
                lines,
        )
        .setColor(0x6c5ce7)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_apodos_add").setLabel("➕ Añadir").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_apodos_remove").setLabel("🗑️ Quitar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_apodos_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_duende").setLabel("◀ Duende").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

async function handleApodosButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_apodos_home") {
        await interaction.update(buildApodosHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_apodos_add") {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId("paneladmin_apodos_add_select")
                .setPlaceholder("¿De quién es el apodo?")
                .setMinValues(1)
                .setMaxValues(1),
        );
        await interaction.reply({ content: "Elige a la persona:", components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }
    if (id === "paneladmin_apodos_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_apodos_remove_modal", "Quitar apodo", [
                { id: "apodo", label: "Apodo a quitar", placeholder: "el marcos" },
            ]),
        );
        return true;
    }
    return false;
}

async function handleApodosUserSelect(interaction) {
    if (interaction.customId !== "paneladmin_apodos_add_select") return false;
    const discordId = interaction.values[0];
    await interaction.showModal(
        simpleModal(`paneladmin_apodos_add_modal_${discordId}`, "Añadir apodo", [
            { id: "apodo", label: "Apodo o nombre", placeholder: "coneyo" },
            { id: "principal", label: "¿Es su nombre? (sí = el Duende le llama así)", placeholder: "no", value: "no", required: false },
        ]),
    );
    return true;
}

async function handleApodosModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_apodos_remove_modal") {
        const apodo = interaction.fields.getTextInputValue("apodo").trim();
        const dueno = apodos.quitar(guildId, apodo);
        if (!dueno) {
            await interaction.reply({ content: `❌ No hay ningún apodo "${apodo}".`, flags: MessageFlags.Ephemeral });
            return true;
        }
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "duende.apodo.remove",
            details: { apodo, discordId: dueno },
        });
        await interaction.reply({ content: `✅ Quitado "${apodo}" de <@${dueno}>.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id.startsWith("paneladmin_apodos_add_modal_")) {
        const discordId = id.replace("paneladmin_apodos_add_modal_", "");
        const apodo = interaction.fields.getTextInputValue("apodo").trim().slice(0, 60);
        const principal = /^(s|si|sí|y|yes|1)$/i.test(interaction.fields.getTextInputValue("principal").trim());
        const r = apodos.anadir(guildId, discordId, apodo, principal);
        if (!r.ok) {
            await interaction.reply({ content: "❌ Apodo vacío.", flags: MessageFlags.Ephemeral });
            return true;
        }
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "duende.apodo.add",
            details: { apodo, discordId, principal, antesDe: r.anterior },
        });
        await interaction.reply({
            content: `✅ "${apodo}" → <@${discordId}>${principal ? " (su nombre)" : ""}.${r.anterior ? ` Antes era de <@${r.anterior}>.` : ""}`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    return false;
}

module.exports = { handleApodosButton, handleApodosUserSelect, handleApodosModal };
