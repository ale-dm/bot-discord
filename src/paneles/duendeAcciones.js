// Panel 💬 del Duende: qué hace cada botón, menú y formulario. El comando /duende (commands/duende/duende.js) reexporta estas acciones.

const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const adminAudit = require("../systems/adminAudit");
const apodos = require("../systems/apodos");
const perfiles = require("../systems/duende/perfiles");
const paneles = require("./duende");
const { esAdmin } = require("../core/permisos");
const { hablar } = require("../services/duende/chat/hablar");
const { createLogger } = require("../core/logger");

const log = createLogger("Duende");

const noOtra = (interaction) =>
    interaction.reply({
        content: "Solo puedes gestionar lo que recuerdo de ti. Para lo de otra persona, pídeselo a un admin.",
        flags: MessageFlags.Ephemeral,
    });
const noPermitido = (interaction) =>
    interaction.reply({ content: "⛔ Solo los administradores pueden hacer esto.", flags: MessageFlags.Ephemeral });

// El chat del Duende espera las opciones del comando: esta capa las traduce desde el formulario 💬 Hablar.
function adaptarHablar(interaction, texto) {
    const adaptada = Object.create(interaction);
    adaptada.options = {
        getSubcommand: () => "talk",
        getString: (nombre) => (nombre === "texto" ? texto : null),
        getUser: () => null,
        getBoolean: () => null,
    };
    adaptada.isChatInputCommand = () => true;
    return adaptada;
}

const vistaInicio = (interaction, aviso = null) => {
    const personalidad = perfiles.personalidadDeCanal(interaction.channelId)
        ? perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(interaction.channelId))
        : null;
    const payload = paneles.buildInicio({ esAdmin: esAdmin(interaction), personalidad });
    if (aviso) payload.embeds[0].setDescription(`${aviso}\n\n${payload.embeds[0].data.description}`);
    return payload;
};
const vistaRecuerdos = (interaction, objetivo, aviso = null) => paneles.buildRecuerdos({ esAdmin: esAdmin(interaction), objetivo, aviso });
const vistaPersonalidad = (interaction, aviso = null) => {
    const actualId = perfiles.personalidadDeCanal(interaction.channelId);
    return paneles.buildPersonalidad({
        esAdmin: esAdmin(interaction),
        canal: interaction.channelId,
        personalidades: perfiles.listarPersonalidades(),
        actual: actualId ? perfiles.obtenerPersonalidad(actualId) : null,
        aviso,
    });
};

// Responde en la misma pantalla si el formulario sale de un mensaje del panel; si no, en privado.
const responder = (interaction, payload) =>
    interaction.isFromMessage?.() ? interaction.update(payload) : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });

// ─── Formularios (modales) ──────────────────────────────────────────────────
function modalHablar() {
    const modal = new ModalBuilder().setCustomId("duendepanel_modal_hablar").setTitle("💬 Hablar con el Duende");
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("texto")
                .setLabel("¿Qué le quieres decir?")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1500)
                .setRequired(true),
        ),
    );
    return modal;
}

function modalAnotar(objetivo) {
    const modal = new ModalBuilder()
        .setCustomId(`duendepanel_modal_anotar_${objetivo.id}`)
        .setTitle(`✏️ Anotar sobre ${objetivo.username}`.slice(0, 45));
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("nota")
                .setLabel("Qué debe recordar el Duende")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(200)
                .setRequired(true),
        ),
    );
    return modal;
}

function modalAddPersonalidad() {
    const modal = new ModalBuilder().setCustomId("duendepanel_modal_add").setTitle("➕ Añadir personalidad");
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("id")
                .setLabel("ID único (sin espacios)")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(40)
                .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("title")
                .setLabel("Título legible")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(60)
                .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("systeminstructions")
                .setLabel("Instrucciones del sistema (prompt)")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(4000)
                .setRequired(true),
        ),
    );
    return modal;
}

// ─── Botones de recuerdos: ✏️ anotar y 🗑️ olvidar (de uno mismo, o de cualquiera si es admin) ───
async function botonRecuerdos(interaction, id, admin) {
    const objetivoId = id.replace(/^duendepanel_(anotar|olvidar)_/, "");
    if (objetivoId !== interaction.user.id && !admin) return noOtra(interaction);
    const objetivo =
        objetivoId === interaction.user.id ? interaction.user : await interaction.client.users.fetch(objetivoId).catch(() => null);
    if (!objetivo) return interaction.reply({ content: "❌ No encuentro a esa persona.", flags: MessageFlags.Ephemeral });

    if (id.startsWith("duendepanel_anotar_")) return interaction.showModal(modalAnotar(objetivo));

    // Olvidar: borra las notas (no la descripción del perfil, que editan los admins en /paneladmin).
    const notas = perfiles.olvidarNotas(objetivo);
    if (!notas.length) return interaction.update(vistaRecuerdos(interaction, objetivo, "No tengo notas guardadas sobre esa persona."));
    log.warn(
        `${interaction.user.tag} (${interaction.user.id}) borró ${notas.length} notas sobre ${objetivo.username}: ${JSON.stringify(notas)}`,
    );
    return interaction.update(vistaRecuerdos(interaction, objetivo, `🗑️ Olvidadas ${notas.length} notas sobre **${objetivo.username}**.`));
}

const acciones = {
    async handleButton(client, interaction) {
        const id = interaction.customId;
        const admin = esAdmin(interaction);
        if (id === "duendepanel_inicio") return interaction.update(vistaInicio(interaction));
        if (id === "duendepanel_hablar") return interaction.showModal(modalHablar());
        if (id === "duendepanel_recuerdos") return interaction.update(vistaRecuerdos(interaction, interaction.user));
        if (id === "duendepanel_personalidad") return interaction.update(vistaPersonalidad(interaction));
        if (id.startsWith("duendepanel_anotar_") || id.startsWith("duendepanel_olvidar_")) return botonRecuerdos(interaction, id, admin);

        // Solo admins: personalidades.
        if (id === "duendepanel_add" || id === "duendepanel_quitar") {
            if (!admin) return noPermitido(interaction);
            if (id === "duendepanel_quitar") {
                return interaction.update(paneles.buildQuitar({ personalidades: perfiles.listarPersonalidades() }));
            }
            return interaction.showModal(modalAddPersonalidad());
        }
    },

    // Menús de personalidad del canal (duendepanel_canal) y de quitar una (duendepanel_quitar_select).
    async handleSelect(client, interaction) {
        if (!esAdmin(interaction)) return noPermitido(interaction);
        const valor = interaction.values[0];
        if (interaction.customId === "duendepanel_canal") {
            if (!perfiles.obtenerPersonalidad(valor))
                return interaction.update(vistaPersonalidad(interaction, `❌ Personalidad '${valor}' no encontrada.`));
            perfiles.asignarPersonalidadCanal(interaction.channelId, valor);
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "duende.personality.set_channel",
                details: { channelId: interaction.channelId, personality: valor },
            });
            return interaction.update(vistaPersonalidad(interaction, `✅ Personalidad del canal: **${valor}**.`));
        }
        if (interaction.customId === "duendepanel_quitar_select") {
            if (!perfiles.borrarPersonalidad(valor))
                return interaction.update(vistaInicio(interaction, `❌ Personalidad '${valor}' no encontrada.`));
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "duende.personality.remove",
                details: { id: valor },
            });
            return interaction.update(vistaInicio(interaction, `🗑️ Personalidad '${valor}' eliminada.`));
        }
    },

    // Selector de persona (solo admins): sus recuerdos.
    async handleUserSelect(client, interaction) {
        if (!esAdmin(interaction)) return noPermitido(interaction);
        const objetivo = interaction.users.first();
        return interaction.update(vistaRecuerdos(interaction, objetivo));
    },

    async handleModal(client, interaction) {
        const id = interaction.customId;
        if (id === "duendepanel_modal_hablar") {
            // La respuesta del Duende sale en el canal, como un mensaje normal; el formulario se cierra sin más.
            return hablar(client, adaptarHablar(interaction, interaction.fields.getTextInputValue("texto")));
        }
        if (id.startsWith("duendepanel_modal_anotar_")) {
            const objetivoId = id.replace("duendepanel_modal_anotar_", "");
            if (objetivoId !== interaction.user.id && !esAdmin(interaction)) return noOtra(interaction);
            const objetivo =
                objetivoId === interaction.user.id ? interaction.user : await interaction.client.users.fetch(objetivoId).catch(() => null);
            if (!objetivo) return interaction.reply({ content: "❌ No encuentro a esa persona.", flags: MessageFlags.Ephemeral });
            const nota = interaction.fields.getTextInputValue("nota").trim();
            const nombre = apodos.nombreDe(interaction.guildId, objetivo.id) || objetivo.globalName || objetivo.username;
            perfiles.anotar(objetivo, nota, nombre);
            log.info(`${interaction.user.tag} guardó una nota sobre ${objetivo.username} (${objetivo.id}): "${nota}"`);
            return responder(interaction, vistaRecuerdos(interaction, objetivo, `📝 Anotado sobre **${objetivo.username}**: "${nota}"`));
        }
        if (id === "duendepanel_modal_add") {
            if (!esAdmin(interaction)) return noPermitido(interaction);
            const pid = interaction.fields.getTextInputValue("id").trim();
            const title = interaction.fields.getTextInputValue("title").trim();
            const si = interaction.fields.getTextInputValue("systeminstructions").trim();
            if (!pid || /\s/.test(pid))
                return responder(interaction, vistaInicio(interaction, "❌ El ID no puede estar vacío ni tener espacios."));
            const existia = perfiles.guardarPersonalidad({ id: pid, title, systemInstructions: si });
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: existia ? "duende.personality.edit" : "duende.personality.add",
                details: { id: pid, title, chars: si.length },
            });
            return responder(interaction, vistaInicio(interaction, `✅ Personalidad '${pid}' ${existia ? "actualizada" : "añadida"}.`));
        }
    },
};

module.exports = { ...acciones, vistaInicio };
