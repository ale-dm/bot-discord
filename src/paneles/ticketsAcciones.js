// 🎫 Los botones y el formulario de los tickets de soporte (#537): «Abrir ticket» del panel público (abre el formulario),
// el envío del formulario (crea el hilo privado), y «Cerrar ticket» del hilo con su confirmación. Quién puede cerrar y
// los permisos del bot se comprueban de nuevo en cada paso: no basta con que el botón esté a la vista.
const tickets = require("../systems/tickets");
const envios = require("../discord/envios/tickets");
const { modalAbrir, confirmacionCierre, ID_ABRIR, ID_MODAL, PREFIJO } = require("./tickets");
const { efimero } = require("../discord/respuestas");
const { esAdmin, tienePermiso } = require("../core/permisos");
const { createLogger } = require("../core/logger");

const log = createLogger("Tickets");

/** ¿Es del staff quien pulsa? Tiene el rol de staff, es admin o puede gestionar hilos. */
function esStaff(interaction, rolStaff) {
    const roles = interaction.member?.roles;
    const tieneRol = !!rolStaff && (Array.isArray(roles) ? roles.includes(rolStaff) : !!roles?.cache?.has?.(rolStaff));
    return tieneRol || esAdmin(interaction) || tienePermiso(interaction, "ManageThreads");
}

/** Si el ticket abierto de alguien ya no tiene hilo en Discord (lo borraron a mano), se da por perdido. */
async function revisarAbierto(interaction) {
    const previo = tickets.abiertoDe(interaction.guildId, interaction.user.id);
    if (!previo?.threadId) return;
    const { perdido } = await envios.hiloDe(interaction.client, previo);
    if (perdido) tickets.marcarPerdido(previo.id);
}

/** «Abrir ticket»: comprueba que se puede y enseña el formulario con las categorías. */
async function abrirFormulario(interaction) {
    if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
    await revisarAbierto(interaction);
    const puede = tickets.comprobarApertura(interaction.guildId, interaction.user.id);
    if (!puede.ok) return interaction.reply(efimero(puede.motivo));
    return interaction.showModal(modalAbrir(puede.config.categorias));
}

/** El formulario enviado: reserva el ticket, crea el hilo privado y avisa al staff. */
async function crearTicket(interaction) {
    if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
    const categoria = interaction.fields.getStringSelectValues?.("categoria")?.[0] ?? "";
    const asunto = interaction.fields.getTextInputValue("asunto");
    await interaction.deferReply(efimero({}));
    const config = tickets.configuracion(interaction.guildId);
    const revision = await envios.revisarCanales(interaction.guild, config);
    if (revision.enTickets.length) {
        log.warn(`No se puede abrir un ticket en ${interaction.guildId}: ${revision.enTickets.join(" ")}`);
        return interaction.editReply({
            content: `❌ No puedo crear tickets ahora mismo. ${revision.enTickets.join(" ")} Avisa a un admin.`,
        });
    }
    const r = tickets.abrir({ guildId: interaction.guildId, autorId: interaction.user.id, categoria, asunto });
    if (!r.ok) return interaction.editReply({ content: r.motivo });
    try {
        const { hilo, mensaje } = await envios.crearHilo(interaction.guild, revision.canal, r.ticket, {
            autor: interaction.user,
            rolStaff: config.rolStaff,
        });
        tickets.guardarHilo(r.ticket.id, hilo.id, mensaje?.id);
        return interaction.editReply({ content: `✅ Ticket #${r.ticket.id} abierto: <#${hilo.id}>. El staff ya está avisado.` });
    } catch (e) {
        tickets.descartar(r.ticket.id);
        log.warn(`No pude crear el hilo del ticket ${r.ticket.id}: ${e.message}`);
        return interaction.editReply({ content: `❌ No pude crear el hilo del ticket (${e.message}). Avisa a un admin.` });
    }
}

/** El ticket del botón, si existe en este servidor, sigue abierto y quien pulsa puede cerrarlo. */
function ticketCerrable(interaction, id) {
    const ticket = tickets.porId(id);
    if (!ticket || ticket.guildId !== interaction.guildId) return { motivo: "❌ Ese ticket no existe." };
    if (ticket.estado !== "abierto") return { motivo: "🔒 Este ticket ya está cerrado." };
    const config = tickets.configuracion(interaction.guildId);
    const staff = esStaff(interaction, config.rolStaff);
    if (!tickets.puedeCerrar(ticket, { userId: interaction.user.id, esStaff: staff })) {
        return { motivo: "⛔ Solo quien abrió el ticket o el staff pueden cerrarlo." };
    }
    return { ticket, config };
}

/** «Cerrar ticket»: pide confirmación (efímera). */
async function pedirConfirmacion(interaction, id) {
    const c = ticketCerrable(interaction, id);
    if (!c.ticket) return interaction.reply(efimero(c.motivo));
    return interaction.reply(efimero(confirmacionCierre(c.ticket, { esAutor: c.ticket.autorId === interaction.user.id })));
}

/** «Sí, cerrar»: lo cierra, manda la transcripción al canal de logs y bloquea el hilo. */
async function confirmarCierre(interaction, id) {
    const c = ticketCerrable(interaction, id);
    if (!c.ticket) return interaction.update({ content: c.motivo, components: [] });
    await interaction.update({ content: "🔒 Cerrando el ticket y guardando la conversación…", components: [] });
    const r = tickets.cerrar(c.ticket.id, interaction.user.id);
    if (!r.ok) return interaction.editReply({ content: r.motivo });
    const ticket = r.ticket;
    const hilo = interaction.channel?.id === ticket.threadId ? interaction.channel : (await envios.hiloDe(interaction.client, ticket)).hilo;
    const envio = await envios.enviarTranscripcion(interaction.guild, hilo, ticket, c.config);
    const porAutor = ticket.autorId === interaction.user.id;
    await envios.cerrarHilo(hilo, ticket, { porAutor, rolStaff: c.config.rolStaff });
    log.info(
        `Ticket ${ticket.id} cerrado por ${interaction.user.tag || interaction.user.id}${envio.ok ? "" : ` sin transcripción (${envio.motivo})`}`,
    );
    return interaction.editReply({
        content: envio.ok
            ? `✅ Ticket #${ticket.id} cerrado. La transcripción está en <#${envio.logsId}>.`
            : `✅ Ticket #${ticket.id} cerrado, pero no pude guardar la transcripción: ${envio.motivo}. Avisa a un admin.`,
    });
}

module.exports = {
    esStaff,
    componentHandlers: [
        { types: ["button"], prefixes: [PREFIJO], method: "handleButton" },
        { types: ["modal"], ids: [ID_MODAL], method: "handleModal" },
    ],

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (id === ID_ABRIR) return abrirFormulario(interaction);
        const m = /^ticket_(cerrar|confirmar|cancelar)_(\d+)$/.exec(id);
        if (!m) return;
        if (m[1] === "cerrar") return pedirConfirmacion(interaction, m[2]);
        if (m[1] === "confirmar") return confirmarCierre(interaction, m[2]);
        return interaction.update({ content: "👍 El ticket sigue abierto.", components: [] });
    },

    async handleModal(client, interaction) {
        if (interaction.customId !== ID_MODAL) return;
        return crearTicket(interaction);
    },
};
