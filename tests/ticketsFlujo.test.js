// Tickets de soporte (#537), el flujo en Discord con dobles: «Abrir ticket» enseña el formulario, el formulario crea el hilo
// privado con el autor y avisa al staff, y «Cerrar ticket» pide confirmación, guarda la transcripción (.txt) en el canal de
// logs y bloquea el hilo. También los permisos: del bot (sin ellos se avisa con el motivo) y de quien cierra.
// BD en memoria; Discord son objetos planos (paneles/ticketsAcciones y discord/envios/tickets no tocan la red).
const { ChannelType } = require("discord.js");
const guildSettings = require("../src/systems/guildSettings");
const tickets = require("../src/systems/tickets");
const acciones = require("../src/paneles/ticketsAcciones");

let n = 0;
const nuevoServidor = () => `g-ticf-${++n}`;
const ROL = "r-staff";

const ids = (payload) => payload.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const textoDe = (mock) => {
    const p = ultimo(mock);
    return typeof p === "string" ? p : p.content;
};

function hiloFalso(id, opciones, mensajes) {
    const hilo = {
        id,
        opciones,
        locked: false,
        archived: false,
        enviados: [],
        miembros: [],
        members: { add: jest.fn(async (u) => hilo.miembros.push(u)) },
        send: jest.fn(async (p) => {
            hilo.enviados.push(p);
            return { id: `${id}-msg-${hilo.enviados.length}` };
        }),
        messages: {
            fetch: jest.fn(async () => new Map(mensajes.map((m) => [m.id, m]))),
            edit: jest.fn(async () => {}),
        },
        setLocked: jest.fn(async (v) => (hilo.locked = v)),
        setArchived: jest.fn(async (v) => (hilo.archived = v)),
        delete: jest.fn(async () => {}),
    };
    return hilo;
}

/** Un servidor configurado con su canal de tickets y su canal de logs. `faltan` = permisos que no tiene el bot. */
function montar({ faltanTickets = [], faltanLogs = [], mensajes = [], fallaHilo = false } = {}) {
    const g = nuevoServidor();
    guildSettings.setManySettings(g, {
        "tickets.canal_id": "c-tickets",
        "tickets.rol_staff": ROL,
        "tickets.canal_logs": "c-logs",
        "tickets.categorias": "Duda\nReporte",
    });
    const hilos = new Map();
    const permisos = (faltan) => () => ({ has: (p) => !faltan.includes(p) });
    const canal = {
        id: "c-tickets",
        type: ChannelType.GuildText,
        permissionsFor: permisos(faltanTickets),
        send: jest.fn(async () => ({ id: "panel-1" })),
        threads: {
            create: jest.fn(async (opciones) => {
                if (fallaHilo) throw new Error("Missing Access");
                const h = hiloFalso(`hilo-${g}-${hilos.size + 1}`, opciones, mensajes);
                hilos.set(h.id, h);
                return h;
            }),
        },
    };
    const logs = { id: "c-logs", type: ChannelType.GuildText, permissionsFor: permisos(faltanLogs), send: jest.fn(async () => ({})) };
    const guild = {
        id: g,
        members: { me: { id: "bot" } },
        channels: {
            cache: new Map([
                [canal.id, canal],
                [logs.id, logs],
            ]),
            fetch: async () => null,
        },
        roles: { cache: new Map([[ROL, { id: ROL, mentionable: true, members: new Map() }]]) },
    };
    const client = {
        channels: {
            fetch: async (id) => {
                if (hilos.has(id)) return hilos.get(id);
                throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
            },
        },
    };
    return { g, guild, client, canal, logs, hilos };
}

function interaccion(s, { userId = "autor-1", staff = false, customId, channel = null, campos = {} } = {}) {
    return {
        customId,
        guildId: s.g,
        guild: s.guild,
        client: s.client,
        channel,
        user: { id: userId, username: `nombre-${userId}`, tag: userId },
        member: { roles: { cache: new Set(staff ? [ROL] : []) } },
        memberPermissions: { has: () => false },
        fields: {
            getStringSelectValues: () => [campos.categoria ?? "Duda"],
            getTextInputValue: () => campos.asunto ?? "No me llega el sueldo del trabajo",
        },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    };
}

/** Abre un ticket entero (formulario enviado) y devuelve el ticket y su hilo. */
async function abrirTicket(s, opciones = {}) {
    const i = interaccion(s, { customId: "ticket_modal", ...opciones });
    await acciones.handleModal(null, i);
    const ticket = tickets.abiertoDe(s.g, opciones.userId || "autor-1");
    return { i, ticket, hilo: ticket && s.hilos.get(ticket.threadId) };
}

describe("abrir un ticket", () => {
    test("«Abrir ticket» enseña el formulario con las categorías del admin", async () => {
        const s = montar();
        const i = interaccion(s, { customId: "ticket_abrir" });
        await acciones.handleButton(null, i);
        const modal = ultimo(i.showModal).toJSON();
        expect(modal.custom_id).toBe("ticket_modal");
        const selector = modal.components[0].component;
        expect(selector.options.map((o) => o.value)).toEqual(["Duda", "Reporte"]);
        expect(modal.components[1].components[0]).toMatchObject({ custom_id: "asunto", min_length: 5, max_length: 1000 });
    });

    test("sin configurar avisa en privado y no enseña el formulario", async () => {
        const s = montar();
        guildSettings.setSetting(s.g, "tickets.rol_staff", "");
        const i = interaccion(s, { customId: "ticket_abrir" });
        await acciones.handleButton(null, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(textoDe(i.reply)).toMatch(/no están configurados/);
    });

    test("crea un hilo privado no invitable, mete al autor y avisa al staff con su rol", async () => {
        const s = montar();
        const { i, ticket, hilo } = await abrirTicket(s);
        expect(s.canal.threads.create).toHaveBeenCalledWith(expect.objectContaining({ type: ChannelType.PrivateThread, invitable: false }));
        expect(hilo.opciones.name).toBe(`🎫 ${ticket.id} · Duda · nombre-autor-1`);
        expect(hilo.miembros).toEqual(["autor-1"]);
        const bienvenida = hilo.enviados[0];
        expect(bienvenida.content).toContain(`<@&${ROL}>`);
        expect(bienvenida.allowedMentions).toEqual({ users: ["autor-1"], roles: [ROL] });
        expect(ids(bienvenida)).toEqual([`ticket_cerrar_${ticket.id}`]);
        expect(ticket).toMatchObject({ threadId: hilo.id, mensajeId: `${hilo.id}-msg-1`, categoria: "Duda", estado: "abierto" });
        expect(textoDe(i.editReply)).toContain(`<#${hilo.id}>`);
    });

    test("con uno abierto, «Abrir ticket» enlaza el hilo que ya tiene", async () => {
        const s = montar();
        const { hilo } = await abrirTicket(s);
        const i = interaccion(s, { customId: "ticket_abrir" });
        await acciones.handleButton(null, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(textoDe(i.reply)).toContain(`Ya tienes un ticket abierto: <#${hilo.id}>`);
    });

    test("si borraron el hilo a mano, el ticket se da por perdido y se puede abrir otro", async () => {
        const s = montar();
        const { ticket } = await abrirTicket(s);
        s.hilos.delete(ticket.threadId);
        const i = interaccion(s, { customId: "ticket_abrir" });
        await acciones.handleButton(null, i);
        expect(i.showModal).toHaveBeenCalled();
        expect(tickets.porId(ticket.id).estado).toBe("perdido");
    });

    test("sin permisos para crear hilos privados avisa con el motivo y no deja ticket", async () => {
        const s = montar({ faltanTickets: ["CreatePrivateThreads", "ManageThreads"] });
        const { i, ticket } = await abrirTicket(s);
        expect(ticket).toBeNull();
        expect(s.canal.threads.create).not.toHaveBeenCalled();
        expect(textoDe(i.editReply)).toMatch(/me falta: «Crear hilos privados», «Gestionar hilos»/);
    });

    test("si Discord no deja crear el hilo, el ticket se descarta y no cuenta la espera", async () => {
        const s = montar({ fallaHilo: true });
        const { i, ticket } = await abrirTicket(s);
        expect(ticket).toBeNull();
        expect(tickets.esperaRestante(s.g, "autor-1")).toBe(0);
        expect(textoDe(i.editReply)).toMatch(/No pude crear el hilo/);
    });
});

describe("cerrar un ticket", () => {
    const conversacion = [
        {
            id: "m2",
            createdTimestamp: 2000,
            author: { id: "staff-1", username: "moderador" },
            content: "Ya lo miro",
            attachments: new Map(),
            embeds: [],
        },
        {
            id: "m1",
            createdTimestamp: 1000,
            author: { id: "autor-1", username: "ana" },
            content: "Hola, ayuda",
            attachments: new Map(),
            embeds: [],
        },
    ];

    test("alguien que no es el autor ni del staff no puede cerrarlo", async () => {
        const s = montar();
        const { ticket } = await abrirTicket(s);
        const i = interaccion(s, { userId: "curioso", customId: `ticket_cerrar_${ticket.id}` });
        await acciones.handleButton(null, i);
        expect(textoDe(i.reply)).toMatch(/Solo quien abrió el ticket o el staff/);
        expect(tickets.porId(ticket.id).estado).toBe("abierto");
    });

    test("el autor recibe una confirmación que avisa de que se avisará al staff", async () => {
        const s = montar();
        const { ticket } = await abrirTicket(s);
        const i = interaccion(s, { customId: `ticket_cerrar_${ticket.id}` });
        await acciones.handleButton(null, i);
        const p = ultimo(i.reply);
        expect(p.content).toMatch(/Se avisará al staff/);
        expect(ids(p)).toEqual([`ticket_confirmar_${ticket.id}`, `ticket_cancelar_${ticket.id}`]);
        expect(tickets.porId(ticket.id).estado).toBe("abierto");
    });

    test("cancelar deja el ticket abierto", async () => {
        const s = montar();
        const { ticket } = await abrirTicket(s);
        const i = interaccion(s, { customId: `ticket_cancelar_${ticket.id}` });
        await acciones.handleButton(null, i);
        expect(textoDe(i.update)).toMatch(/sigue abierto/);
        expect(tickets.porId(ticket.id).estado).toBe("abierto");
    });

    test("el staff lo cierra: queda quién y cuándo, la transcripción va a logs en .txt y el hilo se bloquea", async () => {
        const s = montar({ mensajes: conversacion });
        const { ticket, hilo } = await abrirTicket(s);
        const i = interaccion(s, { userId: "staff-1", staff: true, customId: `ticket_confirmar_${ticket.id}`, channel: hilo });
        await acciones.handleButton(null, i);

        expect(tickets.porId(ticket.id)).toMatchObject({ estado: "cerrado", cerradoPor: "staff-1", autorId: "autor-1" });
        const envio = ultimo(s.logs.send);
        expect(envio.files[0].name).toBe(`ticket-${ticket.id}.txt`);
        const txt = envio.files[0].attachment.toString("utf8");
        expect(txt.indexOf("ana (autor-1): Hola, ayuda")).toBeLessThan(txt.indexOf("moderador (staff-1): Ya lo miro"));
        expect(txt).toContain("Cerrado por: moderador (staff-1)");
        expect(JSON.stringify(envio.embeds[0].toJSON())).toContain("<@staff-1>");
        expect(hilo.locked).toBe(true);
        expect(hilo.archived).toBe(true);
        expect(hilo.messages.edit).toHaveBeenCalledWith(ticket.mensajeId, expect.anything());
        expect(hilo.enviados.at(-1).allowedMentions).toEqual({ parse: [] });
        expect(textoDe(i.editReply)).toMatch(/La transcripción está en <#c-logs>/);
    });

    test("si lo cierra el autor, el aviso de cierre menciona al staff", async () => {
        const s = montar({ mensajes: conversacion });
        const { ticket, hilo } = await abrirTicket(s);
        await acciones.handleButton(null, interaccion(s, { customId: `ticket_confirmar_${ticket.id}`, channel: hilo }));
        const aviso = hilo.enviados.at(-1);
        expect(aviso.content).toContain(`<@&${ROL}>`);
        expect(aviso.allowedMentions).toEqual({ roles: [ROL] });
        expect(tickets.porId(ticket.id).cerradoPor).toBe("autor-1");
    });

    test("una segunda confirmación no lo vuelve a cerrar ni manda otra transcripción", async () => {
        const s = montar();
        const { ticket, hilo } = await abrirTicket(s);
        await acciones.handleButton(null, interaccion(s, { customId: `ticket_confirmar_${ticket.id}`, channel: hilo }));
        const otra = interaccion(s, { userId: "staff-1", staff: true, customId: `ticket_confirmar_${ticket.id}`, channel: hilo });
        await acciones.handleButton(null, otra);
        expect(textoDe(otra.update)).toMatch(/ya está cerrado/);
        expect(s.logs.send).toHaveBeenCalledTimes(1);
        expect(tickets.porId(ticket.id).cerradoPor).toBe("autor-1");
    });

    test("sin permiso para adjuntar en logs se cierra igual y se avisa del motivo", async () => {
        const s = montar({ faltanLogs: ["AttachFiles"] });
        const { ticket, hilo } = await abrirTicket(s);
        const i = interaccion(s, { customId: `ticket_confirmar_${ticket.id}`, channel: hilo });
        await acciones.handleButton(null, i);
        expect(tickets.porId(ticket.id).estado).toBe("cerrado");
        expect(s.logs.send).not.toHaveBeenCalled();
        expect(textoDe(i.editReply)).toMatch(/no pude guardar la transcripción: .*«Adjuntar archivos»/);
    });

    test("tras cerrar, el autor tiene que esperar para abrir otro", async () => {
        const s = montar();
        const { ticket, hilo } = await abrirTicket(s);
        await acciones.handleButton(null, interaccion(s, { customId: `ticket_confirmar_${ticket.id}`, channel: hilo }));
        const i = interaccion(s, { customId: "ticket_abrir" });
        await acciones.handleButton(null, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(textoDe(i.reply)).toMatch(/podrás abrir otro dentro de 60 minutos/);
    });
});
