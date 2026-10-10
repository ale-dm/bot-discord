const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const adminAudit = require("../systems/adminAudit");

function buildAuditPayload(guildId, page = 0, pageSize = 10) {
    // 100 es lo máximo que devuelve adminAudit.listRecent (ver listRecent en adminAudit.js).
    const rows = adminAudit.listRecent(guildId, 100);
    const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const desc = pageRows.length
        ? pageRows
              .map((row) => {
                  const when = new Date(row.createdAt).toLocaleString("es");
                  const details = row.details ? ` · ${JSON.stringify(row.details).slice(0, 90)}` : "";
                  return `• <@${row.actorId}> · **${row.action}** · ${when}${details}`;
              })
              .join("\n")
        : "Sin registros todavía.";

    const embed = new EmbedBuilder()
        .setTitle("🧾 Auditoría Admin")
        .setDescription(desc)
        .setFooter({ text: `Página ${safePage + 1}/${maxPage + 1}` })
        .setColor(0x34495e)
        .setTimestamp();

    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`paneladmin_audit_page_${safePage - 1}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder().setCustomId("paneladmin_audit_refresh").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`paneladmin_audit_page_${safePage + 1}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel").setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [nav] };
}

async function handleAuditButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_audit" || id === "paneladmin_audit_refresh") {
        await interaction.update(buildAuditPayload(interaction.guildId, 0));
        return true;
    }
    if (id.startsWith("paneladmin_audit_page_")) {
        const page = parseInt(id.replace("paneladmin_audit_page_", ""), 10);
        await interaction.update(buildAuditPayload(interaction.guildId, Number.isFinite(page) ? page : 0));
        return true;
    }
    return false;
}

module.exports = { handleAuditButton };
