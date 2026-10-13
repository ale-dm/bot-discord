// ✉️ /mensaje (solo admins): pide a quién y muestra un formulario con el texto; al enviarlo, lo manda por DM de parte del
// bot, con el nombre de quien lo escribe, y lo deja en la auditoría (sin el texto). Discord no se llama.
const db = require("../src/core/db");
const mensaje = require("../src/commands/admin/mensaje");

const G = "guild-mensaje";
const admin = { id: "admin-1", username: "Ana" };
let n = 0;

function interaccionDeAdmin(extra = {}) {
    return {
        guildId: G,
        guild: { id: G, name: "La Inquisición" },
        user: admin,
        member: { permissions: { has: (p) => p === "Administrator" } },
        options: { getUser: jest.fn(() => destino()), getChannel: jest.fn(() => null) },
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        ...extra,
    };
}
function destino(extra = {}) {
    return { id: `dest-${++n}`, username: "Raúl", bot: false, send: jest.fn(async () => {}), ...extra };
}

describe("/mensaje: elegir el destino y abrir el formulario", () => {
    test("el formulario lleva el destino en su id y el campo de texto es de varias líneas", async () => {
        const i = interaccionDeAdmin();
        await mensaje.run({}, i);
        expect(i.showModal).toHaveBeenCalledTimes(1);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toMatch(/^mensaje_modal_dest-/);
        const campo = modal.components[0].components[0].data;
        expect(campo.custom_id).toBe("texto");
        expect(campo.style).toBe(2); // TextInputStyle.Paragraph
    });

    test("a un bot no se le manda nada", async () => {
        const i = interaccionDeAdmin({ options: { getUser: () => destino({ bot: true }), getChannel: () => null } });
        await mensaje.run({}, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/bot/);
    });

    test("sin ser admin no se puede", async () => {
        const i = interaccionDeAdmin({ member: { permissions: { has: () => false } } });
        await mensaje.run({}, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/Solo los admins/);
    });
});

describe("/mensaje: enviar el DM", () => {
    test("manda el texto por DM con el nombre de quien escribe y lo audita sin el texto", async () => {
        const dest = destino();
        const cliente = { users: { fetch: jest.fn(async () => dest) } };
        const i = interaccionDeAdmin({ customId: `mensaje_modal_${dest.id}` });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "  Nos vemos mañana  " } });

        expect(cliente.users.fetch).toHaveBeenCalledWith(dest.id);
        // El DM lleva solo el texto: ni nombre de quien escribe ni de servidor.
        expect(dest.send.mock.calls[0][0]).toEqual({ content: "Nos vemos mañana" });
        expect(i.reply.mock.calls[0][0].content).toMatch(/Mensaje enviado a \*\*Raúl\*\*/);

        const fila = db
            .prepare("SELECT details FROM admin_audit WHERE guildId = ? AND action = 'mensaje.dm' ORDER BY id DESC LIMIT 1")
            .get(G);
        expect(JSON.parse(fila.details)).toEqual({ destinatario: dest.id, caracteres: "Nos vemos mañana".length });
        expect(fila.details).not.toContain("Nos vemos");
    });

    test("si el DM no se puede mandar (DM cerrados), lo dice y no audita", async () => {
        const dest = destino({ send: jest.fn(async () => Promise.reject(new Error("Cannot send messages to this user"))) });
        const cliente = { users: { fetch: async () => dest } };
        const i = interaccionDeAdmin({ customId: `mensaje_modal_${dest.id}` });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "hola" } });
        expect(i.reply.mock.calls[0][0].content).toMatch(/DM cerrados/);
    });

    test("si no encuentra a la persona, lo dice", async () => {
        const cliente = { users: { fetch: async () => null } };
        const i = interaccionDeAdmin({ customId: "mensaje_modal_fantasma" });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "hola" } });
        expect(i.reply.mock.calls[0][0].content).toMatch(/No encuentro/);
    });

    test("un texto solo con espacios no se manda", async () => {
        const dest = destino();
        const cliente = { users: { fetch: async () => dest } };
        const i = interaccionDeAdmin({ customId: `mensaje_modal_${dest.id}` });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "   " } });
        expect(dest.send).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/vacío/);
    });
});

describe("/mensaje canal: publicar en un canal (#433)", () => {
    // Un canal de texto del servidor: el bot tiene (o no) permiso para escribir.
    function canal({ puede = true, id = "chan-1", falla = false } = {}) {
        return {
            id,
            name: "anuncios",
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => puede }),
            send: jest.fn(async () => (falla ? Promise.reject(new Error("Missing Access")) : {})),
        };
    }
    const cliente = { user: { id: "bot" } };
    const conCanal = (c, extra = {}) =>
        interaccionDeAdmin({
            options: { getUser: () => null, getChannel: () => c },
            guild: { id: G, channels: { fetch: async (id) => (c && c.id === id ? c : null) } },
            ...extra,
        });

    test("abre el mismo formulario, con el canal en su id", async () => {
        const i = conCanal(canal());
        await mensaje.run(cliente, i);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe("mensaje_modal_canal_chan-1");
        expect(modal.components[0].components[0].data.custom_id).toBe("texto");
    });

    test("sin usuario ni canal, o con los dos, pide elegir solo uno", async () => {
        const ninguno = interaccionDeAdmin({ options: { getUser: () => null, getChannel: () => null } });
        await mensaje.run(cliente, ninguno);
        expect(ninguno.showModal).not.toHaveBeenCalled();
        expect(ninguno.reply.mock.calls[0][0].content).toMatch(/Elige a quién/);

        const ambos = interaccionDeAdmin({ options: { getUser: () => destino(), getChannel: () => canal() } });
        await mensaje.run(cliente, ambos);
        expect(ambos.showModal).not.toHaveBeenCalled();
        expect(ambos.reply.mock.calls[0][0].content).toMatch(/solo uno/);
    });

    test("si el bot no puede escribir en el canal, avisa en vez de abrir el formulario", async () => {
        const i = conCanal(canal({ puede: false }));
        await mensaje.run(cliente, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/no tengo permiso/);
    });

    test("publica el texto sin menciones que notifiquen y audita solo la cantidad de caracteres", async () => {
        const c = canal();
        const i = conCanal(c, { customId: "mensaje_modal_canal_chan-1" });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "  Sesión el viernes @everyone @here <@123>  " } });

        expect(c.send).toHaveBeenCalledTimes(1);
        expect(c.send.mock.calls[0][0]).toEqual({ content: "Sesión el viernes @everyone @here <@123>", allowedMentions: { parse: [] } });
        expect(i.reply.mock.calls[0][0].content).toMatch(/Mensaje publicado en <#chan-1>/);

        const fila = db
            .prepare("SELECT details FROM admin_audit WHERE guildId = ? AND action = 'mensaje.canal' ORDER BY id DESC LIMIT 1")
            .get(G);
        expect(JSON.parse(fila.details)).toEqual({ canal: "chan-1", caracteres: "Sesión el viernes @everyone @here <@123>".length });
        expect(fila.details).not.toContain("Sesión");
    });

    test("si al enviar el bot ya no puede escribir, o el canal falla, lo dice", async () => {
        const sinPermiso = canal({ puede: false });
        const a = conCanal(sinPermiso, { customId: "mensaje_modal_canal_chan-1" });
        await mensaje.handleModal(cliente, { ...a, fields: { getTextInputValue: () => "hola" } });
        expect(sinPermiso.send).not.toHaveBeenCalled();
        expect(a.reply.mock.calls[0][0].content).toMatch(/no tengo permiso/);

        const roto = canal({ falla: true });
        const b = conCanal(roto, { customId: "mensaje_modal_canal_chan-1" });
        await mensaje.handleModal(cliente, { ...b, fields: { getTextInputValue: () => "hola" } });
        expect(b.reply.mock.calls[0][0].content).toMatch(/No pude publicar/);
    });

    test("un canal que no existe en el servidor se dice, y sin ser admin no se publica nada", async () => {
        const c = canal();
        const i = conCanal(c, { customId: "mensaje_modal_canal_otro" });
        await mensaje.handleModal(cliente, { ...i, fields: { getTextInputValue: () => "hola" } });
        expect(c.send).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/No encuentro ese canal/);

        const noAdmin = conCanal(c, { customId: "mensaje_modal_canal_chan-1", member: { permissions: { has: () => false } } });
        await mensaje.handleModal(cliente, { ...noAdmin, fields: { getTextInputValue: () => "hola" } });
        expect(c.send).not.toHaveBeenCalled();
        expect(noAdmin.reply.mock.calls[0][0].content).toMatch(/Solo los admins/);
    });

    test("con `usuario` todo sigue igual: DM y formulario con el id del usuario", async () => {
        const i = interaccionDeAdmin();
        await mensaje.run(cliente, i);
        expect(i.showModal.mock.calls[0][0].data.custom_id).toMatch(/^mensaje_modal_dest-/);
    });
});
