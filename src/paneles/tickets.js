// 🎫 Los mensajes de los tickets de soporte (#537): el panel público con el botón de abrir, el formulario (categoría y
// asunto), el mensaje de bienvenida del hilo con su botón de cerrar, la confirmación, el aviso de cierre y el registro que
// va al canal de logs junto a la transcripción. Las reglas, en systems/tickets; los botones, en paneles/ticketsAcciones.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    StringSelectMenuBuilder,
} = require("discord.js");
const tickets = require("../systems/tickets");

const COLOR_ABIERTO = 0x3498db;
const COLOR_CERRADO = 0x95a5a6;
const PREFIJO = "ticket_";
const ID_ABRIR = "ticket_abrir";
const ID_MODAL = "ticket_modal";

const segundos = (ms) => Math.floor(ms / 1000);

/** El panel público que se publica en el canal de tickets. */
function panelPublico() {
    const embed = new EmbedBuilder()
        .setTitle("🎫 Soporte")
        .setColor(COLOR_ABIERTO)
        .setDescription(
            "¿Necesitas ayuda del staff, quieres reportar algo o apelar una sanción?\n\n" +
                "Pulsa **🎫 Abrir ticket**, elige la categoría y cuéntanos qué pasa. Se crea un **hilo privado** que solo ven " +
                "tú y el staff.\n\nUn ticket abierto por persona; al cerrarlo, hay que esperar una hora para abrir otro.",
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID_ABRIR).setLabel("🎫 Abrir ticket").setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** El formulario para abrir un ticket: la categoría (de las que ha puesto el admin) y el asunto. */
function modalAbrir(categorias) {
    const selector = new StringSelectMenuBuilder()
        .setCustomId("categoria")
        .setRequired(true)
        .setPlaceholder("Elige una categoría")
        .addOptions(categorias.map((c, i) => ({ label: c, value: c, default: i === 0 })));
    return new ModalBuilder()
        .setCustomId(ID_MODAL)
        .setTitle("Abrir ticket")
        .addLabelComponents(new LabelBuilder().setLabel("Categoría").setStringSelectMenuComponent(selector))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("asunto")
                    .setLabel("¿Qué necesitas?")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(tickets.MIN_ASUNTO)
                    .setMaxLength(tickets.MAX_ASUNTO),
            ),
        );
}

/** El nombre del hilo (Discord admite 100 caracteres). */
const nombreHilo = (ticket, nombreAutor) => `🎫 ${ticket.id} · ${ticket.categoria} · ${nombreAutor}`.slice(0, 100);

/** La fila con el botón de cerrar; desactivado si el ticket ya está cerrado. */
function filaCerrar(ticket) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${PREFIJO}cerrar_${ticket.id}`)
            .setLabel(ticket.estado === "abierto" ? "🔒 Cerrar ticket" : "🔒 Cerrado")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(ticket.estado !== "abierto"),
    );
}

/** El primer mensaje del hilo: menciona al autor y al staff, con el asunto y el botón de cerrar. */
function mensajeBienvenida(ticket, rolStaff) {
    const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket #${ticket.id} · ${ticket.categoria}`)
        .setColor(ticket.estado === "abierto" ? COLOR_ABIERTO : COLOR_CERRADO)
        .setDescription(ticket.asunto || "Sin asunto.")
        .addFields(
            { name: "Abierto por", value: `<@${ticket.autorId}>`, inline: true },
            { name: "Desde", value: `<t:${segundos(ticket.abiertoEn)}:f>`, inline: true },
        )
        .setFooter({ text: "Escribe aquí: solo lo ven tú y el staff. Pueden cerrarlo el autor o el staff." });
    return {
        content: `<@${ticket.autorId}> <@&${rolStaff}> · nuevo ticket de **${ticket.categoria}**`,
        embeds: [embed],
        components: [filaCerrar(ticket)],
        allowedMentions: { users: [String(ticket.autorId)], roles: [String(rolStaff)] },
    };
}

/** La confirmación (efímera) antes de cerrar. Al autor se le dice que se avisará al staff. */
function confirmacionCierre(ticket, { esAutor }) {
    const texto = esAutor
        ? "¿Seguro que quieres cerrar tu ticket? Se avisará al staff, se guardará la conversación y el hilo quedará bloqueado."
        : `¿Cerrar el ticket #${ticket.id}? Se guardará la conversación en el canal de logs y el hilo quedará bloqueado.`;
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}confirmar_${ticket.id}`).setLabel("✅ Sí, cerrar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIJO}cancelar_${ticket.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    );
    return { content: `🔒 ${texto}`, components: [fila] };
}

/** El aviso que queda en el hilo al cerrarlo. Si lo cierra el autor, suena para el staff. */
function avisoCierre(ticket, { porAutor, rolStaff }) {
    const quien = porAutor ? `su autor, <@${ticket.cerradoPor}>` : `<@${ticket.cerradoPor}>`;
    const aviso = porAutor && rolStaff ? `<@&${rolStaff}> ` : "";
    return {
        content: `${aviso}🔒 Ticket #${ticket.id} cerrado por ${quien}. La conversación se ha guardado y el hilo queda bloqueado.`,
        allowedMentions: porAutor && rolStaff ? { roles: [String(rolStaff)] } : { parse: [] },
    };
}

/** Una duración legible (de minutos a días). */
function duracion(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h ${min % 60} min`;
    return `${Math.floor(h / 24)} días`;
}

/** El registro del canal de logs que acompaña al .txt: quién lo abrió y lo cerró, cuándo y cuántos mensajes. */
function registroCierre(ticket, transcripcion) {
    const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket #${ticket.id} cerrado · ${ticket.categoria}`)
        .setColor(COLOR_CERRADO)
        .setDescription((ticket.asunto || "Sin asunto.").slice(0, 1000))
        .addFields(
            { name: "Abierto por", value: `<@${ticket.autorId}>`, inline: true },
            { name: "Cerrado por", value: `<@${ticket.cerradoPor}>`, inline: true },
            { name: "Hilo", value: ticket.threadId ? `<#${ticket.threadId}>` : "—", inline: true },
            { name: "Abierto", value: `<t:${segundos(ticket.abiertoEn)}:f>`, inline: true },
            { name: "Cerrado", value: `<t:${segundos(ticket.cerradoEn)}:f>`, inline: true },
            { name: "Duración", value: duracion(ticket.cerradoEn - ticket.abiertoEn), inline: true },
            {
                name: "Mensajes",
                value: transcripcion.recortada
                    ? `${transcripcion.incluidos} de ${transcripcion.total} (recortada por tamaño)`
                    : String(transcripcion.total),
            },
        )
        .setTimestamp(ticket.cerradoEn);
    return { embeds: [embed], allowedMentions: { parse: [] } };
}

module.exports = {
    PREFIJO,
    ID_ABRIR,
    ID_MODAL,
    panelPublico,
    modalAbrir,
    nombreHilo,
    filaCerrar,
    mensajeBienvenida,
    confirmacionCierre,
    avisoCierre,
    duracion,
    registroCierre,
};
