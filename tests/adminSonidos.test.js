// 🔊 Sonidos en /paneladmin (subir con formulario y archivo, borrar con un menú) y /conectar (el canal que se elige, o el
// tuyo, y si ya está conectado se sale). Los formularios y los menús se simulan: no hay Discord.
const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../src/core/db");
const sonidos = require("../src/systems/sonidos");
const presencia = require("../src/systems/presencia");
const admin = require("../src/adminPanel/sonidos");
const sonidosCmd = require("../src/commands/voz/sonidos");
const conectar = require("../src/commands/voz/conectar");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-sonidos-"));
process.env.SONIDOS_DIR = dir;
const G = "g-admin-sonidos";

beforeEach(() => {
    db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(500, 1).buffer }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const botones = (payload) => payload.components[0].components.map((b) => b.data);

describe("el panel de admin", () => {
    test("sin sonidos: se puede subir, no se puede borrar", () => {
        const p = admin.buildSonidosHome(G);
        const [subir, borrar] = botones(p);
        expect(subir.custom_id).toBe("paneladmin_sonidos_subir");
        expect(subir.disabled).toBeFalsy();
        expect(borrar.disabled).toBe(true);
    });

    test("con sonidos, los lista y deja borrar", async () => {
        db.prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, 'Risa', 'x.mp3', 'a', 0)").run(G);
        const p = admin.buildSonidosHome(G);
        expect(p.embeds[0].data.description).toMatch(/🔊 Risa/);
        expect(botones(p)[1].disabled).toBeFalsy();
    });

    test("el formulario de subir pide un nombre y un archivo", () => {
        const modal = admin.modalSubir().toJSON();
        const tipos = modal.components.map((l) => l.component.type);
        expect(tipos).toEqual([4, 19]); // texto y subida de archivo
    });

    test("subir desde el formulario guarda el sonido y lo confirma en privado", async () => {
        const reply = jest.fn(async () => {});
        const interaction = {
            customId: "paneladmin_sonidos_modal_subir",
            guildId: G,
            user: { id: "admin", tag: "admin" },
            fields: {
                getTextInputValue: () => "Aplauso",
                getUploadedFiles: () => ({ first: () => ({ name: "aplauso.mp3", url: "https://cdn/x", size: 500 }) }),
            },
            reply,
        };
        expect(await admin.handleSonidosModal(interaction)).toBe(true);
        expect(reply.mock.calls[0][0].content).toMatch(/Aplauso\*\* añadido/);
        expect(sonidos.listar(G).map((s) => s.nombre)).toEqual(["Aplauso"]);
    });

    test("un formulario sin archivo, o con un formato malo, no guarda nada", async () => {
        const reply = jest.fn(async () => {});
        await admin.handleSonidosModal({
            customId: "paneladmin_sonidos_modal_subir",
            guildId: G,
            user: { id: "admin" },
            fields: { getTextInputValue: () => "Nada", getUploadedFiles: () => null },
            reply,
        });
        expect(reply.mock.calls[0][0].content).toMatch(/No llegó ningún archivo/);
        await admin.handleSonidosModal({
            customId: "paneladmin_sonidos_modal_subir",
            guildId: G,
            user: { id: "admin" },
            fields: { getTextInputValue: () => "Texto", getUploadedFiles: () => ({ first: () => ({ name: "t.txt", url: "u", size: 5 }) }) },
            reply,
        });
        expect(reply.mock.calls[1][0].content).toMatch(/Formato no válido/);
        expect(sonidos.listar(G)).toEqual([]);
    });

    test("borrar desde el menú quita el sonido", async () => {
        const r = await sonidos.guardar(G, {
            nombre: "Borrame",
            archivo: { nombreArchivo: "b.mp3", url: "u", tamano: 10 },
            userId: "admin",
        });
        const update = jest.fn(async () => {});
        await admin.handleSonidosStringSelect({
            customId: "paneladmin_sonidos_borrar_select",
            guildId: G,
            user: { id: "admin", tag: "admin" },
            values: [String(r.sonido.id)],
            update,
        });
        expect(update.mock.calls[0][0].content).toMatch(/Borrado \*\*Borrame\*\*/);
        expect(sonidos.listar(G)).toEqual([]);
    });
});

describe("los comandos", () => {
    test("/sonidos ya no tiene opciones de admin: solo abre el panel", () => {
        expect(sonidosCmd.data.options).toHaveLength(0);
    });

    test("/conectar lleva la opción canal, solo de voz", () => {
        const opcion = conectar.data.options.find((o) => o.name === "canal");
        expect(opcion).toBeDefined();
        expect(opcion.toJSON().channel_types).toEqual([2]); // GuildVoice
    });

    function interaccion({ canal = null, enVoz = null } = {}) {
        return {
            guildId: G,
            user: { id: "ana" },
            member: { voice: { channel: enVoz } },
            options: { getChannel: () => canal },
            reply: jest.fn(async () => {}),
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
    }

    test("sin canal y sin estar en voz, lo pide", async () => {
        const i = interaccion();
        await conectar.run(null, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Entra a un canal de voz/);
    });

    test("con el canal elegido, entra y lo dice con la hora de salida", async () => {
        const spy = jest.spyOn(presencia, "conectar").mockResolvedValue({ ok: true, canal: "General", expira: Date.now() + 30 * 60000 });
        const elegido = { id: "c9", name: "General" };
        const i = interaccion({ canal: elegido });
        await conectar.run(null, i);
        expect(spy).toHaveBeenCalledWith(elegido);
        expect(i.editReply.mock.calls[0][0]).toMatch(/Conectado a \*\*General\*\*.*<t:\d+:t>/);
        spy.mockRestore();
    });

    test("sin canal, si ya está conectado, se sale", async () => {
        const spy = jest.spyOn(presencia, "actual").mockReturnValue({ canalNombre: "General" });
        const des = jest.spyOn(presencia, "desconectar").mockReturnValue(true);
        const i = interaccion();
        await conectar.run(null, i);
        expect(des).toHaveBeenCalledWith(G);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Me he salido/);
        spy.mockRestore();
        des.mockRestore();
    });
});
