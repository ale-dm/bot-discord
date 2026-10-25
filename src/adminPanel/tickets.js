// Panel admin → ⚙️ Config Global → 📣 Comunidad → 🎫 Tickets (#537): el canal de tickets (donde se crean los hilos privados
// y se publica el panel público), el rol de staff, el canal de las transcripciones y las categorías («General» por
// defecto). Desde aquí se publica el panel público; antes se comprueba que el bot tiene los permisos que necesita.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const tickets = require("../systems/tickets");
const adminAudit = require("../systems/adminAudit");
const envios = require("../discord/envios/tickets");
const { panelPublico } = require("../paneles/tickets");
const { modalConCampos, simpleModal, canalElegido, rolElegido } = require("./common");
const { guardarAuditado } = require("./settings/guardar");

const COLOR = 0x3498db;
const canalTexto = (id) => (id ? `<#${id}>` : "Sin elegir");

/** La pantalla de Tickets: la configuración, lo que falta, los abiertos y los botones. */
function buildTicketsPanel(guildId, aviso = "") {
    const cfg = tickets.configuracion(guildId);
    const abiertos = tickets.abiertos(guildId, 5);
    const total = tickets.cuentaAbiertos(guildId);
    const estado = cfg.lista ? "✅ Listo para publicar el panel." : `⚠️ Falta ${cfg.falta.join(", ")}.`;
    const embed = new EmbedBuilder()
        .setTitle("🎫 Tickets")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Cada ticket es un hilo privado entre quien lo abre y el staff. Uno abierto por persona y una hora de espera " +
                `tras cerrarlo. Al cerrarlo, la conversación va en un .txt al canal de transcripciones.\n\n${estado}`,
        )
        .addFields(
            { name: "📂 Canal de tickets", value: canalTexto(cfg.canalId), inline: true },
            { name: "🛡️ Rol de staff", value: cfg.rolStaff ? `<@&${cfg.rolStaff}>` : "Sin elegir", inline: true },
            { name: "📜 Transcripciones", value: canalTexto(cfg.canalLogs), inline: true },
            { name: "🏷️ Categorías", value: cfg.categorias.join(" · ") },
            {
                name: `📬 Abiertos (${total})`,
                value: abiertos.length
                    ? abiertos
                          .map((t) => `**#${t.id}** · ${t.categoria} · <@${t.autorId}> · ${t.threadId ? `<#${t.threadId}>` : "creándose"}`)
                          .join("\n")
                    : "Ninguno.",
            },
        );
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_tic_cfg").setLabel("⚙️ Canales y rol").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_tic_cat").setLabel("🏷️ Categorías").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("paneladmin_tic_publicar")
            .setLabel("📤 Publicar panel")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!cfg.lista),
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_com_home").setLabel("📣 Comunidad").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [acciones, nav], allowedMentions: { parse: [] } };
}

/** Tras guardar: repinta la pantalla si el formulario salió de ella, o la manda aparte. */
async function responder(interaction, payload) {
    if (interaction.isFromMessage?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Lo que le falta al bot con la configuración actual, como aviso (vacío si todo está bien). */
async function avisoPermisos(guild, cfg) {
    if (!guild || !cfg.lista) return "";
    const r = await envios.revisarCanales(guild, cfg);
    const problemas = [...r.problemas];
    const mencion = envios.rolMencionable(guild, r.canal, cfg.rolStaff);
    if (!mencion.rol) problemas.push("No encuentro el rol de staff.");
    else if (r.canal && !mencion.suena) {
        problemas.push(
            "El rol de staff no se puede mencionar y me falta «Mencionar @everyone, @here y todos los roles»: meteré a mano en " +
                "el hilo a los del staff que conozca.",
        );
    }
    return problemas.length ? `⚠️ ${problemas.join("\n⚠️ ")}` : "";
}

async function abrirConfiguracion(interaction) {
    const cfg = tickets.configuracion(interaction.guildId);
    await interaction.showModal(
        modalConCampos("paneladmin_tic_cfg_modal", "Tickets", [
            { id: "canal", label: "Canal de tickets (hilos y panel)", tipo: "canal", required: false, valor: cfg.canalId },
            { id: "rol", label: "Rol de staff", tipo: "rol", required: false, valor: cfg.rolStaff },
            { id: "logs", label: "Canal de transcripciones", tipo: "canal", required: false, valor: cfg.canalLogs },
        ]),
    );
}

async function abrirCategorias(interaction) {
    const cfg = tickets.configuracion(interaction.guildId);
    await interaction.showModal(
        simpleModal("paneladmin_tic_cat_modal", "Categorías de tickets", [
            {
                id: "categorias",
                label: `Una por línea (máx. ${tickets.MAX_CATEGORIAS})`,
                paragraph: true,
                required: false,
                maxLength: (tickets.MAX_CATEGORIA + 1) * tickets.MAX_CATEGORIAS,
                placeholder: "Vacío = solo General",
                value: cfg.categorias.join("\n"),
            },
        ]),
    );
}

/** Publica el panel público en el canal de tickets, si el bot puede crear hilos ahí. */
async function publicarPanel(interaction) {
    const guildId = interaction.guildId;
    const cfg = tickets.configuracion(guildId);
    if (!cfg.lista) return interaction.update(buildTicketsPanel(guildId, `❌ Falta ${cfg.falta.join(", ")}.`));
    const r = await envios.revisarCanales(interaction.guild, cfg);
    if (r.enTickets.length) return interaction.update(buildTicketsPanel(guildId, `❌ No publico el panel: ${r.enTickets.join(" ")}`));
    const mensaje = await r.canal.send(panelPublico());
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "tickets.publicar",
        details: { canal: cfg.canalId, mensaje: mensaje.id },
    });
    const extra = r.enLogs.length ? `\n⚠️ ${r.enLogs.join(" ")}` : "";
    return interaction.update(
        buildTicketsPanel(guildId, `✅ Panel publicado: https://discord.com/channels/${guildId}/${cfg.canalId}/${mensaje.id}${extra}`),
    );
}

async function handleTicketsButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith("paneladmin_tic_")) return false;
    if (id === "paneladmin_tic_home") await interaction.update(buildTicketsPanel(interaction.guildId));
    else if (id === "paneladmin_tic_cfg") await abrirConfiguracion(interaction);
    else if (id === "paneladmin_tic_cat") await abrirCategorias(interaction);
    else if (id === "paneladmin_tic_publicar") await publicarPanel(interaction);
    else return false;
    return true;
}

async function guardarConfiguracion(interaction) {
    const guildId = interaction.guildId;
    const canal = canalElegido(interaction.fields, "canal");
    const logs = canalElegido(interaction.fields, "logs");
    const rol = rolElegido(interaction.fields, "rol");
    guardarAuditado(guildId, interaction.user.id, "tickets.config", {
        "tickets.canal_id": canal,
        "tickets.rol_staff": rol,
        "tickets.canal_logs": logs,
    });
    const cfg = tickets.configuracion(guildId);
    const permisos = await avisoPermisos(interaction.guild, cfg);
    await responder(interaction, buildTicketsPanel(guildId, `✅ Guardado.${permisos ? `\n${permisos}` : ""}`));
}

async function guardarCategorias(interaction) {
    const r = tickets.normalizarCategorias(interaction.fields.getTextInputValue("categorias"));
    if (!r.ok) {
        await interaction.reply({ content: r.motivo, flags: MessageFlags.Ephemeral });
        return;
    }
    guardarAuditado(interaction.guildId, interaction.user.id, "tickets.categorias", { "tickets.categorias": r.categorias.join("\n") });
    await responder(interaction, buildTicketsPanel(interaction.guildId, `✅ Categorías: ${r.categorias.join(" · ")}.`));
}

async function handleTicketsModal(interaction) {
    if (interaction.customId === "paneladmin_tic_cfg_modal") await guardarConfiguracion(interaction);
    else if (interaction.customId === "paneladmin_tic_cat_modal") await guardarCategorias(interaction);
    else return false;
    return true;
}

module.exports = { buildTicketsPanel, handleTicketsButton, handleTicketsModal };
