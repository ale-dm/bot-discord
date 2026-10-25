// Panel admin → 📣 Comunidad → 🎫 Tickets (#537): configurar el canal de tickets, el rol de staff y el canal de
// transcripciones, las categorías («General» por defecto) y publicar el panel público. Solo admins, todo auditado y
// con aviso de los permisos que le faltan al bot. BD en memoria; Discord son objetos planos.
const { ChannelType } = require("discord.js");
const guildSettings = require("../src/systems/guildSettings");
const adminAudit = require("../src/systems/adminAudit");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildComunidadHome } = require("../src/adminPanel/comunidad");
const { buildTicketsPanel } = require("../src/adminPanel/tickets");

let n = 0;
const nuevoServidor = () => `g-tica-${++n}`;
const ids = (payload) => payload.components.flatMap((f) => (f.toJSON ? f.toJSON() : f).components.map((c) => c.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const descripcion = (payload) => payload.embeds[0].toJSON().description;

function guildFalso(g, { faltan = [], rolMencionable = true } = {}) {
    const canal = {
        id: "c-tickets",
        type: ChannelType.GuildText,
        permissionsFor: () => ({ has: (p) => !faltan.includes(p) }),
        send: jest.fn(async () => ({ id: "msg-panel" })),
    };
    const logs = { id: "c-logs", type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), send: jest.fn() };
    return {
        canal,
        guild: {
            id: g,
            members: { me: { id: "bot" } },
            channels: {
                cache: new Map([
                    [canal.id, canal],
                    [logs.id, logs],
                ]),
                fetch: async () => null,
            },
            roles: { cache: new Map([["r-staff", { id: "r-staff", mentionable: rolMencionable, members: new Map() }]]) },
        },
    };
}

function interaccion(g, guild, extra = {}) {
    return {
        guildId: g,
        guild,
        client: {},
        user: { id: "admin-tic", tag: "admin#1" },
        memberPermissions: { has: () => true },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    };
}

const campos = (valores) => ({
    getTextInputValue: (id) => valores[id] ?? "",
    getSelectedChannels: (id) => (valores[id] ? new Map([[valores[id], {}]]) : null),
    getSelectedRoles: (id) => (valores[id] ? new Map([[valores[id], {}]]) : null),
});

const configurar = (g) =>
    guildSettings.setManySettings(g, { "tickets.canal_id": "c-tickets", "tickets.rol_staff": "r-staff", "tickets.canal_logs": "c-logs" });

describe("🎫 Tickets en el panel admin", () => {
    test("📣 Comunidad lleva a 🎫 Tickets sin pasar de 5 botones por fila", () => {
        const p = buildComunidadHome(nuevoServidor());
        expect(ids(p)).toContain("paneladmin_tic_home");
        for (const fila of p.components) expect(fila.toJSON().components.length).toBeLessThanOrEqual(5);
    });

    test("sin configurar dice lo que falta, enseña General y no deja publicar", () => {
        const p = buildTicketsPanel(nuevoServidor());
        expect(descripcion(p)).toContain("Falta el canal de tickets, el rol de staff, el canal de transcripciones");
        expect(JSON.stringify(p.embeds[0].toJSON().fields)).toContain("General");
        const publicar = p.components[0].toJSON().components.find((c) => c.custom_id === "paneladmin_tic_publicar");
        expect(publicar.disabled).toBe(true);
        expect(ids(p)).toEqual(expect.arrayContaining(["paneladmin_com_home", "paneladmin_cfg_home"]));
    });

    test("un no admin recibe «No tienes permisos.» y no cambia nada", async () => {
        const g = nuevoServidor();
        const { guild } = guildFalso(g);
        const i = interaccion(g, guild, {
            customId: "paneladmin_tic_cfg_modal",
            memberPermissions: { has: () => false },
            fields: campos({ canal: "c-tickets", rol: "r-staff", logs: "c-logs" }),
        });
        await paneladmin.handleModal(i.client, i);
        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(guildSettings.getSettings(g).tickets.canal_id).toBe("");
    });

    test("guardar canales y rol los deja en los ajustes y en la auditoría con el antes y el después", async () => {
        const g = nuevoServidor();
        const { guild } = guildFalso(g);
        const i = interaccion(g, guild, {
            customId: "paneladmin_tic_cfg_modal",
            fields: campos({ canal: "c-tickets", rol: "r-staff", logs: "c-logs" }),
        });
        await paneladmin.handleModal(i.client, i);
        expect(guildSettings.getSettings(g).tickets).toMatchObject({ canal_id: "c-tickets", rol_staff: "r-staff", canal_logs: "c-logs" });
        const fila = adminAudit.listRecent(g, 5).find((a) => a.action === "tickets.config");
        expect(fila.details.cambios["tickets.rol_staff"]).toEqual({ antes: "", despues: "r-staff" });
        expect(descripcion(ultimo(i.update))).toContain("✅ Guardado.");
    });

    test("al guardar avisa de los permisos que le faltan al bot y de un rol que no puede mencionar", async () => {
        const g = nuevoServidor();
        const { guild } = guildFalso(g, { faltan: ["ManageThreads", "MentionEveryone"], rolMencionable: false });
        const i = interaccion(g, guild, {
            customId: "paneladmin_tic_cfg_modal",
            fields: campos({ canal: "c-tickets", rol: "r-staff", logs: "c-logs" }),
        });
        await paneladmin.handleModal(i.client, i);
        const texto = descripcion(ultimo(i.update));
        expect(texto).toContain("En <#c-tickets> me falta: «Gestionar hilos».");
        expect(texto).toContain("El rol de staff no se puede mencionar");
    });

    test("las categorías se guardan limpias y auditadas; demasiadas se rechazan sin tocar nada", async () => {
        const g = nuevoServidor();
        const { guild } = guildFalso(g);
        const i = interaccion(g, guild, { customId: "paneladmin_tic_cat_modal", fields: campos({ categorias: "Duda\n reporte \nduda" }) });
        await paneladmin.handleModal(i.client, i);
        expect(guildSettings.getSettings(g).tickets.categorias).toBe("Duda\nreporte");
        expect(adminAudit.listRecent(g, 5).some((a) => a.action === "tickets.categorias")).toBe(true);

        const muchas = Array.from({ length: 11 }, (_, k) => `C${k}`).join("\n");
        const mal = interaccion(g, guild, { customId: "paneladmin_tic_cat_modal", fields: campos({ categorias: muchas }) });
        await paneladmin.handleModal(mal.client, mal);
        expect(ultimo(mal.reply).content).toMatch(/Como mucho 10/);
        expect(guildSettings.getSettings(g).tickets.categorias).toBe("Duda\nreporte");
    });

    test("el botón de categorías abre el formulario con las de ahora", async () => {
        const g = nuevoServidor();
        const { guild } = guildFalso(g);
        const i = interaccion(g, guild, { customId: "paneladmin_tic_cat" });
        await paneladmin.handleButton(i.client, i);
        const campo = ultimo(i.showModal).toJSON().components[0].components[0];
        expect(campo).toMatchObject({ custom_id: "categorias", value: "General" });
    });

    test("publicar manda el panel público con «Abrir ticket» al canal de tickets y lo audita", async () => {
        const g = nuevoServidor();
        configurar(g);
        const { guild, canal } = guildFalso(g);
        const i = interaccion(g, guild, { customId: "paneladmin_tic_publicar" });
        await paneladmin.handleButton(i.client, i);
        expect(ids(ultimo(canal.send))).toEqual(["ticket_abrir"]);
        expect(adminAudit.listRecent(g, 5).find((a) => a.action === "tickets.publicar").details).toEqual({
            canal: "c-tickets",
            mensaje: "msg-panel",
        });
        expect(descripcion(ultimo(i.update))).toContain(`https://discord.com/channels/${g}/c-tickets/msg-panel`);
    });

    test("sin permiso para crear hilos privados no publica y dice por qué", async () => {
        const g = nuevoServidor();
        configurar(g);
        const { guild, canal } = guildFalso(g, { faltan: ["CreatePrivateThreads"] });
        const i = interaccion(g, guild, { customId: "paneladmin_tic_publicar" });
        await paneladmin.handleButton(i.client, i);
        expect(canal.send).not.toHaveBeenCalled();
        expect(descripcion(ultimo(i.update))).toContain("No publico el panel: En <#c-tickets> me falta: «Crear hilos privados».");
        expect(adminAudit.listRecent(g, 5).some((a) => a.action === "tickets.publicar")).toBe(false);
    });
});
