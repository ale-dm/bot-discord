// 🎫 Lo que los tickets (#537) hacen en Discord: comprobar los permisos del bot, crear el hilo privado y meter al autor
// (y al staff si su rol no se puede mencionar), leer la conversación, mandar la transcripción al canal de logs y cerrar
// el hilo (aviso, botón desactivado, bloqueado y archivado). Todo lo que no sea crear el hilo es best-effort.
const { AttachmentBuilder, ChannelType, ThreadAutoArchiveDuration } = require("discord.js");
const tickets = require("../../systems/tickets");
const { generarTranscripcion } = require("../../systems/ticketsTranscripcion");
const { mensajeBienvenida, nombreHilo, avisoCierre, filaCerrar, registroCierre } = require("../../paneles/tickets");
const { createLogger } = require("../../core/logger");

const log = createLogger("Tickets");

/** Mensajes que se leen como mucho de un hilo para la transcripción (de 100 en 100). */
const MAX_MENSAJES = 2000;
/** Miembros del staff que se añaden a mano al hilo cuando su rol no se puede mencionar. */
const MAX_STAFF_A_MANO = 25;

const canalDe = async (guild, id) => (id ? guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null)) : null);

/** Los permisos de `lista` que le faltan al bot en `canal` (todos si no se pueden leer). */
function faltanPermisos(canal, me, lista) {
    const permisos = canal?.permissionsFor?.(me);
    if (!permisos) return [...lista];
    return lista.filter((p) => !permisos.has(p));
}

/**
 * Comprueba que el canal de tickets y el de logs existen y que el bot tiene lo que necesita en cada uno.
 * @returns {{ ok: boolean, canal, logs, enTickets: string[], enLogs: string[], problemas: string[] }} qué falta, en español
 * (`enTickets` impide abrir tickets; `enLogs`, guardar la transcripción).
 */
async function revisarCanales(guild, config) {
    const me = guild.members?.me;
    const canal = await canalDe(guild, config.canalId);
    const logs = await canalDe(guild, config.canalLogs);
    const enTickets = [];
    const enLogs = [];
    if (!canal) enTickets.push("No encuentro el canal de tickets.");
    else if (canal.type !== undefined && canal.type !== ChannelType.GuildText) {
        enTickets.push(`<#${canal.id}> no es un canal de texto normal: ahí no se pueden crear hilos privados.`);
    } else {
        const faltan = faltanPermisos(canal, me, tickets.PERMISOS_HILOS);
        if (faltan.length) enTickets.push(`En <#${canal.id}> me falta: ${tickets.describirPermisos(faltan)}.`);
    }
    if (!logs) enLogs.push("No encuentro el canal de transcripciones.");
    else {
        const faltan = faltanPermisos(logs, me, tickets.PERMISOS_LOGS);
        if (faltan.length) enLogs.push(`En <#${logs.id}> me falta: ${tickets.describirPermisos(faltan)}.`);
    }
    const problemas = [...enTickets, ...enLogs];
    return { ok: problemas.length === 0, canal, logs, enTickets, enLogs, problemas };
}

/** ¿Sonará la mención del rol de staff? Si el rol no es mencionable, el bot necesita «Mencionar a todos». */
function rolMencionable(guild, canal, rolId) {
    const rol = guild.roles?.cache?.get(rolId);
    if (!rol) return { rol: null, suena: false };
    return { rol, suena: !!rol.mentionable || faltanPermisos(canal, guild.members?.me, ["MentionEveryone"]).length === 0 };
}

/** Si la mención del rol no va a sonar, mete a mano en el hilo a los del staff que el bot conoce (best-effort). */
async function meterStaff(hilo, guild, canal, rolId) {
    const { rol, suena } = rolMencionable(guild, canal, rolId);
    if (!rol || suena) return;
    for (const miembro of [...(rol.members?.values?.() || [])].slice(0, MAX_STAFF_A_MANO)) {
        await hilo.members.add(miembro.id).catch((e) => log.debug(`No pude meter a ${miembro.id} en el hilo ${hilo.id}: ${e.message}`));
    }
}

/** Crea el hilo privado del ticket, mete al autor y publica la bienvenida. Lanza si no se puede crear el hilo. */
async function crearHilo(guild, canal, ticket, { autor, rolStaff }) {
    const hilo = await canal.threads.create({
        name: nombreHilo(ticket, autor.username || autor.id),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Ticket #${ticket.id} de ${autor.username || autor.id}`,
    });
    try {
        await hilo.members.add(autor.id);
        await meterStaff(hilo, guild, canal, rolStaff);
        const mensaje = await hilo.send(mensajeBienvenida(ticket, rolStaff));
        return { hilo, mensaje };
    } catch (e) {
        // Sin el autor dentro o sin bienvenida, el hilo no sirve: se borra para no dejarlo huérfano.
        await hilo.delete().catch((err) => log.debug(`No pude borrar el hilo a medias ${hilo.id}: ${err.message}`));
        throw e;
    }
}

/** Un mensaje de Discord como objeto plano para la transcripción. */
const planoDe = (m) => ({
    fecha: m.createdTimestamp,
    autor: m.author?.username || m.author?.tag || "desconocido",
    autorId: m.author?.id,
    texto: m.content || "",
    adjuntos: [...(m.attachments?.values?.() || [])].map((a) => a.url),
    embeds: (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(" — ")),
});

/** Los mensajes del hilo, del más antiguo al más nuevo (hasta MAX_MENSAJES). */
async function leerMensajes(hilo, max = MAX_MENSAJES) {
    const todos = [];
    let antes;
    while (todos.length < max) {
        const lote = await hilo.messages.fetch({ limit: 100, ...(antes ? { before: antes } : {}) });
        const lista = [...lote.values()];
        if (!lista.length) break;
        todos.push(...lista);
        antes = lista[lista.length - 1].id;
        if (lista.length < 100) break;
    }
    return todos
        .slice(0, max)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(planoDe);
}

/** Lee el hilo y manda la transcripción (.txt) con su registro al canal de logs. @returns {{ ok, motivo?, transcripcion? }} */
async function enviarTranscripcion(guild, hilo, ticket, config) {
    const logs = await canalDe(guild, config.canalLogs);
    if (!logs) return { ok: false, motivo: "no encuentro el canal de transcripciones" };
    const faltan = faltanPermisos(logs, guild.members?.me, tickets.PERMISOS_LOGS);
    if (faltan.length) return { ok: false, motivo: `en <#${logs.id}> me falta ${tickets.describirPermisos(faltan)}` };
    try {
        const mensajes = hilo ? await leerMensajes(hilo) : [];
        const nombres = {
            autor: mensajes.find((m) => m.autorId === ticket.autorId)?.autor,
            cerradoPor: mensajes.find((m) => m.autorId === ticket.cerradoPor)?.autor,
        };
        const t = generarTranscripcion(ticket, mensajes, { nombres });
        const archivo = new AttachmentBuilder(Buffer.from(t.texto, "utf8"), { name: `ticket-${ticket.id}.txt` });
        await logs.send({ ...registroCierre(ticket, t), files: [archivo] });
        return { ok: true, transcripcion: t, logsId: logs.id };
    } catch (e) {
        log.warn(`No pude mandar la transcripción del ticket ${ticket.id}: ${e.message}`);
        return { ok: false, motivo: e.message };
    }
}

/** Deja el aviso de cierre en el hilo, desactiva el botón de la bienvenida y bloquea y archiva el hilo (best-effort). */
async function cerrarHilo(hilo, ticket, { porAutor, rolStaff }) {
    if (!hilo) return;
    const paso = async (que, fn) => {
        try {
            await fn();
        } catch (e) {
            log.debug(`Ticket ${ticket.id}: no pude ${que}: ${e.message}`);
        }
    };
    await paso("avisar del cierre", () => hilo.send(avisoCierre(ticket, { porAutor, rolStaff })));
    if (ticket.mensajeId)
        await paso("desactivar el botón", () => hilo.messages.edit(ticket.mensajeId, { components: [filaCerrar(ticket)] }));
    await paso("bloquear el hilo", () => hilo.setLocked(true, `Ticket #${ticket.id} cerrado`));
    await paso("archivar el hilo", () => hilo.setArchived(true, `Ticket #${ticket.id} cerrado`));
}

/** El hilo de un ticket, o null si ya no existe. `perdido` = Discord dice que no existe (no es un fallo de red). */
async function hiloDe(client, ticket) {
    if (!ticket.threadId) return { hilo: null, perdido: false };
    try {
        return { hilo: await client.channels.fetch(ticket.threadId), perdido: false };
    } catch (e) {
        return { hilo: null, perdido: e.code === 10003 };
    }
}

module.exports = {
    MAX_MENSAJES,
    faltanPermisos,
    revisarCanales,
    rolMencionable,
    crearHilo,
    planoDe,
    leerMensajes,
    enviarTranscripcion,
    cerrarHilo,
    hiloDe,
};
