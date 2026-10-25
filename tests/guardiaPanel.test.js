// 🛡️ Guardia en el panel de /duende (#553): el botón entra al canal de voz de quien pulsa o abre el formulario para
// elegirlo, avisa si faltan permisos, enseña el estado y solo deja quitarla o moverla a quien la puso o a un admin (también
// comprobado al pulsar). BD en memoria; la voz se simula con jest.mock de @discordjs/voice (no se conecta nada).
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-guardia-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const conexiones = [];
jest.mock("@discordjs/voice", () => ({
    ...jest.requireActual("@discordjs/voice"),
    joinVoiceChannel: jest.fn(() => {
        const c = new (require("events").EventEmitter)();
        c.destroy = jest.fn(() => c.emit("destroyed"));
        conexiones.push(c);
        return c;
    }),
    entersState: jest.fn(async () => {}),
}));

const { MessageFlags } = require("discord.js");
const duende = require("../src/commands/duende/duende");
const presencia = require("../src/systems/presencia");
const guardia = require("../src/systems/guardia");
const db = require("../src/core/db");

const G = "g-guardia-panel";
const guild = {
    id: G,
    voiceAdapterCreator: () => {},
    members: { me: {} },
    channels: { fetch: async (id) => canales.get(id) ?? null },
};
const canalVoz = (id, permisos = true) => ({
    id,
    name: `Voz ${id}`,
    guild,
    isVoiceBased: () => true,
    permissionsFor: () => (permisos ? { has: () => true } : null),
});
const canales = new Map([
    ["v1", canalVoz("v1")],
    ["v2", canalVoz("v2")],
    ["v-cerrado", canalVoz("v-cerrado", false)],
]);

function pulsar({ customId, userId = "ana", admin = false, enCanal = null, elegido = null } = {}) {
    return {
        customId,
        guildId: G,
        guild,
        channelId: "texto-1",
        user: { id: userId, username: userId, tag: userId },
        member: { permissions: { has: () => admin }, voice: { channel: enCanal ? canales.get(enCanal) : null } },
        fields: { getSelectedChannels: () => (elegido ? new Map([[elegido, { id: elegido }]]) : null) },
        isButton: () => customId.startsWith("duendepanel_guardia"),
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    };
}
const boton = (payload, id) => payload.components.flatMap((r) => r.components).find((b) => b.data.custom_id === id);
const textoEmbed = (payload) =>
    [payload.embeds[0].data.description, ...(payload.embeds[0].data.fields ?? []).map((f) => `${f.name} ${f.value}`)].join(" ");
const fila = () => db.prepare("SELECT * FROM guardia_voz WHERE guildId = ?").get(G);
const ponerComo = (userId, canalId = "v1") =>
    duende.handleButton(null, pulsar({ customId: "duendepanel_guardia", userId, enCanal: canalId }));

beforeEach(() => {
    presencia.desconectar(G);
    db.prepare("DELETE FROM guardia_voz").run();
    conexiones.length = 0;
});
afterEach(() => jest.clearAllMocks());

describe("🛡️ Guardia", () => {
    test("quien está en un canal de voz pone la guardia ahí y queda guardada", async () => {
        const i = pulsar({ customId: "duendepanel_guardia", enCanal: "v1" });
        await duende.handleButton(null, i);
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(textoEmbed(i.editReply.mock.calls[0][0])).toMatch(/De guardia en \*\*Voz v1\*\*/);
        expect(guardia.actual(G)).toMatchObject({ canalId: "v1", porUserId: "ana" });
        expect(fila()).toMatchObject({ canalId: "v1", porUserId: "ana" });
    });

    test("sin estar en un canal de voz, abre el formulario con un selector de canales de voz", async () => {
        const i = pulsar({ customId: "duendepanel_guardia" });
        await duende.handleButton(null, i);
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("duendepanel_modal_guardia");
        expect(modal.components[0].label.length).toBeLessThanOrEqual(45);
        expect(modal.components[0].component).toMatchObject({ custom_id: "canal", channel_types: [2], min_values: 1, max_values: 1 });
        expect(conexiones).toHaveLength(0);
    });

    test("el formulario pone la guardia en el canal elegido", async () => {
        const i = pulsar({ customId: "duendepanel_modal_guardia", elegido: "v2" });
        await duende.handleModal(null, i);
        expect(textoEmbed(i.editReply.mock.calls[0][0])).toMatch(/De guardia en \*\*Voz v2\*\*/);
        expect(fila()).toMatchObject({ canalId: "v2" });
    });

    test("el formulario sin un canal válido no conecta", async () => {
        const i = pulsar({ customId: "duendepanel_modal_guardia", elegido: "no-existe" });
        await duende.handleModal(null, i);
        expect(textoEmbed(i.editReply.mock.calls[0][0])).toMatch(/Elige un canal de voz/);
        expect(conexiones).toHaveLength(0);
        expect(fila()).toBeUndefined();
    });

    test("sin permisos de Conectar/Hablar avisa del motivo y no guarda nada", async () => {
        const i = pulsar({ customId: "duendepanel_guardia", enCanal: "v-cerrado" });
        await duende.handleButton(null, i);
        expect(textoEmbed(i.editReply.mock.calls[0][0])).toMatch(/Me faltan permisos/);
        expect(conexiones).toHaveLength(0);
        expect(fila()).toBeUndefined();
    });

    test("quien la puso puede moverla a su canal nuevo", async () => {
        await ponerComo("ana", "v1");
        await ponerComo("ana", "v2");
        expect(conexiones[0].destroy).toHaveBeenCalled();
        expect(fila()).toMatchObject({ canalId: "v2", porUserId: "ana" });
    });

    test("otra persona no puede moverla: ve el aviso y la guardia sigue donde estaba", async () => {
        await ponerComo("ana", "v1");
        const i = pulsar({ customId: "duendepanel_guardia", userId: "luis", enCanal: "v2" });
        await duende.handleButton(null, i);
        expect(i.reply.mock.calls[0][0]).toMatchObject({
            flags: MessageFlags.Ephemeral,
            content: expect.stringMatching(/Solo quien puso/),
        });
        expect(guardia.actual(G).canalId).toBe("v1");
    });
});

describe("estado en el panel", () => {
    test("con guardia, enseña el canal y quién la puso; los botones están deshabilitados para el resto", async () => {
        await ponerComo("ana", "v1");
        const i = { ...pulsar({ customId: "x", userId: "luis" }), options: {} };
        await duende.run(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(textoEmbed(payload)).toMatch(/Voz v1.*<@ana>/);
        expect(boton(payload, "duendepanel_guardia").data.disabled).toBe(true);
        expect(boton(payload, "duendepanel_guardia_dejar").data.disabled).toBe(true);
        expect(payload.components[0].components.length).toBeLessThanOrEqual(5);
    });

    test("quien la puso y los admins ven los botones habilitados", async () => {
        await ponerComo("ana", "v1");
        for (const quien of [pulsar({ customId: "x", userId: "ana" }), pulsar({ customId: "x", userId: "jefa", admin: true })]) {
            const i = { ...quien, options: {} };
            await duende.run(null, i);
            expect(boton(i.reply.mock.calls[0][0], "duendepanel_guardia_dejar").data.disabled).toBe(false);
        }
    });

    test("sin guardia no hay botón de dejarla", async () => {
        const i = { ...pulsar({ customId: "x" }), options: {} };
        await duende.run(null, i);
        expect(boton(i.reply.mock.calls[0][0], "duendepanel_guardia_dejar")).toBeUndefined();
    });
});

describe("🚪 Dejar la guardia", () => {
    test("otra persona no puede dejarla aunque pulse el botón: se comprueba en el servidor", async () => {
        await ponerComo("ana", "v1");
        const i = pulsar({ customId: "duendepanel_guardia_dejar", userId: "luis" });
        await duende.handleButton(null, i);
        expect(i.reply.mock.calls[0][0]).toMatchObject({
            flags: MessageFlags.Ephemeral,
            content: expect.stringMatching(/Solo quien puso/),
        });
        expect(conexiones[0].destroy).not.toHaveBeenCalled();
        expect(fila()).toBeDefined();
    });

    test("quien la puso la deja: se desconecta y se borra el registro", async () => {
        await ponerComo("ana", "v1");
        const i = pulsar({ customId: "duendepanel_guardia_dejar", userId: "ana" });
        await duende.handleButton(null, i);
        expect(conexiones[0].destroy).toHaveBeenCalled();
        expect(textoEmbed(i.update.mock.calls[0][0])).toMatch(/He dejado la guardia/);
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });

    test("un admin también puede dejarla", async () => {
        await ponerComo("ana", "v1");
        await duende.handleButton(null, pulsar({ customId: "duendepanel_guardia_dejar", userId: "jefa", admin: true }));
        expect(guardia.actual(G)).toBeNull();
        expect(fila()).toBeUndefined();
    });
});
