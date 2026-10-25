// 🧾 Auditoría: las últimas 100 acciones de los admins, de 10 en 10, con un filtro por familia de acción (el prefijo antes del
// primer punto: bank.*, settings.*...). El filtro viaja en el customId de los botones, así que ◀ ▶ y 🔄 lo conservan.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const adminAudit = require("../systems/adminAudit");

const FAMILIAS = {
    bank: "🏦 Banco",
    settings: "⚙️ Ajustes",
    alertas: "🔔 Alertas",
    logs: "📜 Logs",
    mensaje: "✉️ Mensajes",
    duende: "🧙 Duende",
    xp: "⭐ Niveles y XP",
    plex: "🎬 Plex",
    seerr: "📥 Seerr",
    apuestas: "⚽ Apuestas",
    quiniela: "🎟️ Quiniela",
    impuestos: "🧾 Impuestos",
    clasificacion: "🏆 Clasificación",
    objeto: "🛒 Catálogo",
    consulta: "👁️ Consultas",
    backup: "💾 Copias",
    tarea: "🕒 Tareas",
    mantenimiento: "🛠️ Mantenimiento",
    tickets: "🎫 Tickets",
    roles: "⏳ Roles temporales",
    calendario: "📅 Calendario",
};

function buildAuditPayload(guildId, page = 0, pageSize = 10, familia = null) {
    const fam = FAMILIAS[familia] ? familia : null;
    // 100 es lo máximo que devuelve adminAudit.listRecent (también con filtro).
    const rows = adminAudit.listRecent(guildId, 100, fam);
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
        : fam
          ? `Sin registros de ${FAMILIAS[fam]}.`
          : "Sin registros todavía.";

    const embed = new EmbedBuilder()
        .setTitle("🧾 Auditoría Admin")
        .setDescription(desc)
        .setFooter({ text: `Página ${safePage + 1}/${maxPage + 1}${fam ? ` · Filtro: ${FAMILIAS[fam]}` : ""}` })
        .setColor(0x34495e)
        .setTimestamp();

    const sufijo = fam ? `_${fam}` : "";
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`paneladmin_audit_page_${safePage - 1}${sufijo}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder().setCustomId(`paneladmin_audit_refresh${sufijo}`).setLabel("🔄 Refrescar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`paneladmin_audit_page_${safePage + 1}${sufijo}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel").setStyle(ButtonStyle.Secondary),
    );
    const filtro = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("paneladmin_audit_filtro")
            .setPlaceholder(fam ? `Filtro: ${FAMILIAS[fam]}` : "Filtrar por familia de acción")
            .addOptions([
                { label: "Todas las acciones", value: "todas", default: !fam },
                ...Object.entries(FAMILIAS).map(([value, label]) => ({ label, value, default: value === fam })),
            ]),
    );

    return { embeds: [embed], components: [nav, filtro] };
}

/** `paneladmin_audit_page_3_bank` → { pagina: 3, familia: "bank" } (la familia es opcional). */
function leerPagina(id) {
    const m = /^paneladmin_audit_page_([^_]*)(?:_([a-z_]+))?$/.exec(id);
    return m ? { pagina: parseInt(m[1], 10) || 0, familia: m[2] || null } : null;
}

async function handleAuditButton(interaction) {
    const id = interaction.customId;
    const refresco = /^paneladmin_audit(?:_refresh(?:_([a-z_]+))?)?$/.exec(id);
    if (refresco) {
        await interaction.update(buildAuditPayload(interaction.guildId, 0, 10, refresco[1] || null));
        return true;
    }
    const p = leerPagina(id);
    if (!p) return false;
    await interaction.update(buildAuditPayload(interaction.guildId, p.pagina, 10, p.familia));
    return true;
}

async function handleAuditSelect(interaction) {
    if (interaction.customId !== "paneladmin_audit_filtro") return false;
    await interaction.update(buildAuditPayload(interaction.guildId, 0, 10, interaction.values[0]));
    return true;
}

module.exports = { handleAuditButton, handleAuditSelect, buildAuditPayload, FAMILIAS };
