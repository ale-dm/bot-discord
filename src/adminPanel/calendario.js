// ⚙️ Config Global → 📅 Calendario (#540): el canal fijo de los recordatorios, cuántos minutos antes avisan y qué
// competiciones salen; añadir eventos manuales (título y fecha en hora de Madrid) y borrar los próximos. Todo se audita
// (familia `calendario`). Lo ve todo el mundo con /calendario.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const calendario = require("../systems/calendario");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { DEPORTES } = require("../services/oddsApi");
const { paginaDeLista } = require("../paneles/menuPaginado");
const { modalConCampos, canalElegido } = require("./common");

const PREFIJO = "paneladmin_cal_";
const COLOR = 0x16a085;
const MINUTOS_MAX = 10080;

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;
const corto = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const auditar = (interaction, action, details) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });

function buildHome(guildId, aviso = "") {
    const a = calendario.ajustes(guildId);
    const manuales = calendario.manualesProximos(guildId);
    const embed = new EmbedBuilder()
        .setTitle("📅 Calendario")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "`/calendario` junta sesiones de cine, cumpleaños, partidos, el cierre de las quinielas y los eventos de aquí.",
        )
        .addFields(
            {
                name: "Recordatorios",
                value: a.canal && a.recordatorioMin ? `En <#${a.canal}>, **${a.recordatorioMin}** min antes` : "Apagados",
                inline: true,
            },
            {
                name: "Competiciones",
                value: a.competiciones.length ? a.competiciones.map((c) => DEPORTES[c].name).join(", ") : "Ninguna",
                inline: true,
            },
            {
                name: `Eventos propios (${manuales.length})`,
                value: manuales.length
                    ? manuales
                          .slice(0, 10)
                          .map((e) => `**#${e.id}** · ${ts(e.inicio)} · ${corto(e.titulo, 80)}`)
                          .join("\n")
                    : "Ninguno.",
            },
        );
    const filas = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIJO}nuevo`).setLabel("➕ Añadir evento").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${PREFIJO}ajustes`).setLabel("⚙️ Ajustes").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
        ),
    ];
    if (manuales.length) {
        filas.unshift(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${PREFIJO}borrar`)
                    .setPlaceholder("Borrar un evento propio")
                    .addOptions(
                        paginaDeLista(manuales).items.map((e) => ({
                            label: corto(`#${e.id} · ${e.titulo}`, 100),
                            description: new Date(e.inicio).toLocaleString("es", { timeZone: "Europe/Madrid" }),
                            value: String(e.id),
                        })),
                    ),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

const modalNuevo = () =>
    modalConCampos(`${PREFIJO}nuevo_modal`, "Nuevo evento", [
        { id: "titulo", label: "Título", maxLength: calendario.TITULO_MAX },
        { id: "fecha", label: "Fecha (DD/MM/AAAA HH:MM, hora de Madrid)", placeholder: "31/12/2026 22:00", maxLength: 16 },
    ]);

function modalAjustes(guildId) {
    const a = calendario.ajustes(guildId);
    return modalConCampos(`${PREFIJO}ajustes_modal`, "Ajustes del calendario", [
        { id: "canal", label: "Canal de los recordatorios", tipo: "canal", required: false, valor: a.canal },
        { id: "minutos", label: `Minutos antes (0 = sin recordatorios)`, value: String(a.recordatorioMin), maxLength: 5 },
        {
            id: "competiciones",
            label: "Competiciones (separadas por comas)",
            value: a.competiciones.join(", "),
            required: false,
            maxLength: 200,
        },
    ]);
}

async function guardarNuevo(interaction) {
    const r = calendario.crearManual({
        guildId: interaction.guildId,
        titulo: interaction.fields.getTextInputValue("titulo"),
        fecha: interaction.fields.getTextInputValue("fecha"),
        porId: interaction.user.id,
    });
    if (r.ok) auditar(interaction, "calendario.crear", { id: r.id, inicio: r.inicio });
    await interaction.update(buildHome(interaction.guildId, r.ok ? `✅ Evento #${r.id} el ${ts(r.inicio)}.` : `❌ ${r.motivo}`));
}

async function guardarAjustes(interaction) {
    const f = interaction.fields;
    const texto = f.getTextInputValue("minutos").trim();
    const minutos = Number(texto);
    if (!/^\d+$/.test(texto) || minutos > MINUTOS_MAX) {
        await interaction.update(buildHome(interaction.guildId, `❌ Los minutos van de 0 a ${MINUTOS_MAX}.`));
        return;
    }
    const escritas = String(f.getTextInputValue("competiciones") || "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
    const validas = calendario.competicionesDe(escritas.join(","));
    const malas = escritas.filter((c) => !DEPORTES[c]);
    if (malas.length) {
        await interaction.update(
            buildHome(interaction.guildId, `❌ No conozco: ${malas.join(", ")}. Valen: ${Object.keys(DEPORTES).join(", ")}.`),
        );
        return;
    }
    const valores = {
        "calendario.canal": canalElegido(f, "canal"),
        "calendario.recordatorio_min": minutos,
        "calendario.competiciones": validas.join(","),
    };
    for (const [clave, valor] of Object.entries(valores)) guildSettings.setSetting(interaction.guildId, clave, valor);
    auditar(interaction, "calendario.ajustes", valores);
    await interaction.update(buildHome(interaction.guildId, "✅ Ajustes guardados."));
}

/** Botones de 📅 Calendario. Devuelve false si no es suyo. */
async function handleCalendarioButton(interaction) {
    const id = interaction.customId;
    if (id === `${PREFIJO}home`) await interaction.update(buildHome(interaction.guildId));
    else if (id === `${PREFIJO}nuevo`) await interaction.showModal(modalNuevo());
    else if (id === `${PREFIJO}ajustes`) await interaction.showModal(modalAjustes(interaction.guildId));
    else return false;
    return true;
}

/** Formularios de 📅 Calendario. */
async function handleCalendarioModal(interaction) {
    if (interaction.customId === `${PREFIJO}nuevo_modal`) await guardarNuevo(interaction);
    else if (interaction.customId === `${PREFIJO}ajustes_modal`) await guardarAjustes(interaction);
    else return false;
    return true;
}

/** Borrar un evento propio desde el desplegable. */
async function handleCalendarioSelect(interaction) {
    if (interaction.customId !== `${PREFIJO}borrar`) return false;
    const e = calendario.borrarManual(interaction.guildId, interaction.values[0]);
    if (e) auditar(interaction, "calendario.borrar", { id: e.id, titulo: e.titulo });
    await interaction.update(buildHome(interaction.guildId, e ? `🗑️ Borrado «${corto(e.titulo, 80)}».` : "Ese evento ya no existe."));
    return true;
}

module.exports = { PREFIJO, buildHome, handleCalendarioButton, handleCalendarioModal, handleCalendarioSelect };
