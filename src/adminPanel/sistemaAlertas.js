// Panel admin → 🩺 Sistema → 🔔 Alertas: estado, categorías que llegan (#422), canal de respaldo (#423), configuración y prueba.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const guildSettings = require("../systems/guildSettings");
const alertas = require("../systems/alertas");
const { CREDITOS_AVISO } = require("../services/oddsApi");
const { modalConCampos, SI_NO_NUMERICO, usuariosElegidos, canalElegido } = require("./common");
const { guardarAuditado } = require("./settings/guardar");

function buildAlertas(guild, aviso = "") {
    const e = alertas.estado(guild?.id);
    const quien = e.adminIds.length
        ? e.adminIds.map((id) => `<@${id}>`).join(", ")
        : `el dueño del servidor${guild?.ownerId ? ` (<@${guild.ownerId}>)` : ""}`;
    const ultimas = e.historial.length
        ? e.historial.map((h) => `<t:${Math.floor(h.at / 1000)}:R> ${h.titulo} → ${h.enviadas}/${h.destinatarios}`).join("\n")
        : "Ninguna desde el arranque.";
    const embed = new EmbedBuilder()
        .setTitle("🔔 Alertas por DM")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Avisan por mensaje privado de: errores nuevos del bot (el mismo error, como mucho una vez cada 6 h), " +
                `Odds API con menos de ${CREDITOS_AVISO} créditos, Gemini sin cuota, un modelo de Gemini que no funciona al ` +
                `arrancar y copias de seguridad que fallan. Como mucho ${alertas.MAX_POR_HORA} a la hora.

` +
                "Además, cada lunes a las 09:00, un 📊 resumen de la semana (errores, comandos más usados, Gemini y Odds API).",
        )
        .addFields(
            { name: "Estado", value: e.activas ? "Activas" : "Desactivadas", inline: true },
            { name: "A quién", value: quien.slice(0, 1024), inline: true },
            {
                name: "Categorías",
                value: Object.entries(alertas.CATEGORIAS)
                    .map(([c, nombre]) => `${e.tipos.includes(c) ? "✅" : "⬜"} ${nombre}`)
                    .join("\n"),
                inline: false,
            },
            { name: "Canal de respaldo", value: e.canal ? `<#${e.canal}> (si nadie recibe el DM)` : "Sin canal", inline: true },
            { name: "Últimas enviadas", value: ultimas.slice(0, 1024), inline: false },
        )
        .setColor(e.activas ? 0x2ecc71 : 0x95a5a6)
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sis_alertas_editar").setLabel("✏️ Configurar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_sis_alertas_probar").setLabel("📨 Probar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_sis_resumen").setLabel("📊 Resumen semanal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_sis_home").setLabel("◀ Sistema").setStyle(ButtonStyle.Secondary),
    );
    const categorias = new ActionRowBuilder().addComponents(
        ...Object.entries(alertas.CATEGORIAS).map(([c, nombre]) =>
            new ButtonBuilder()
                .setCustomId(`paneladmin_sis_alertas_tipo_${c}`)
                .setLabel(nombre)
                .setStyle(e.tipos.includes(c) ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: [fila, categorias] };
}

async function probarAlertas(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const enviadas = await alertas.probar(interaction.user.username);
    const total = alertas.destinatarios().length;
    await interaction.editReply({
        content: total
            ? `📨 Alerta de prueba enviada a ${enviadas} de ${total}.${enviadas < total ? " Quien no la recibe tiene los DMs cerrados para el bot." : ""}`
            : "❌ No hay a quién enviarla: las alertas están desactivadas.",
    });
    return true;
}

// Activa o desactiva una categoría de alerta sin tocar las demás (#422).
async function alternarCategoria(interaction, categoria) {
    if (!alertas.CATEGORIAS[categoria]) return false;
    const { tipos } = alertas.estado(interaction.guildId);
    const nuevos = tipos.includes(categoria) ? tipos.filter((t) => t !== categoria) : [...tipos, categoria];
    guardarAuditado(interaction.guildId, interaction.user.id, "alertas.categorias", { "alertas.tipos": nuevos.join(",") });
    await interaction.update(buildAlertas(interaction.guild));
    return true;
}

async function abrirModalAlertas(interaction) {
    const cfg = guildSettings.getSettings(interaction.guildId).alertas;
    await interaction.showModal(
        modalConCampos("paneladmin_sis_alertas_modal", "Alertas por DM", [
            { id: "activas", label: "Alertas activas", tipo: "radio", opciones: SI_NO_NUMERICO, valor: cfg.enabled ? "1" : "0" },
            {
                id: "ids",
                label: "Quién recibe las alertas",
                tipo: "usuario",
                multiple: true,
                required: false,
                valores: guildSettings.parseCsvIds(cfg.admin_ids || ""),
            },
            { id: "canal", label: "Canal de respaldo (si no llega el DM)", tipo: "canal", required: false, valor: cfg.canal || "" },
        ]),
    );
    return true;
}

async function handleAlertasModal(interaction) {
    if (interaction.customId !== "paneladmin_sis_alertas_modal") return false;
    const activas = interaction.fields.getRadioGroup("activas");
    const ids = usuariosElegidos(interaction.fields, "ids");
    const malos = ids.filter((id) => !/^\d{17,20}$/.test(id));
    if (malos.length) {
        await interaction.reply({
            content: `❌ Esto no son IDs de Discord: ${malos.join(", ").slice(0, 200)}. (Clic derecho en la persona → Copiar ID de usuario.)`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    guardarAuditado(interaction.guildId, interaction.user.id, "alertas.config", {
        "alertas.enabled": activas,
        "alertas.admin_ids": ids.join(","),
        "alertas.canal": canalElegido(interaction.fields, "canal"),
    });
    const payload = buildAlertas(interaction.guild, "✅ Alertas actualizadas.");
    if (interaction.isFromMessage?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { buildAlertas, probarAlertas, alternarCategoria, abrirModalAlertas, handleAlertasModal };
