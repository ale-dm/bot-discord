// /duende como panel único (F-DU-06, #113): /duende abre el panel, 🧠 Recuerdos (anotar, olvidar y ver lo que recuerda)
// con los permisos de cada caso, y 🎭 Personalidad (añadir, elegir la del canal y quitar, solo admins).
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-panel-"));
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const duende = require("../src/commands/duende/duende");
const perfiles = require("../src/systems/duende/perfiles");
const db = require("../src/core/db");
const { MessageFlags } = require("discord.js");

const alex = { id: "u1", username: "alex", tag: "alex" };
const raul = { id: "raul-id", username: "raul", tag: "raul" };

function panel({ user = alex, admin = false, customId, values, usersFirst, texto, nota, fields = {}, channelId = "canal-1" } = {}) {
    return {
        customId,
        values,
        user,
        channelId,
        channel: { id: channelId },
        guildId: "guild-1",
        member: { permissions: { has: () => admin } },
        client: { users: { fetch: async (id) => (id === raul.id ? raul : { id, username: id }) } },
        users: { first: () => usersFirst },
        fields: {
            getTextInputValue: (campo) => {
                if (campo in fields) return fields[campo];
                if (campo === "texto") return texto;
                if (campo === "nota") return nota;
                return "";
            },
        },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
    };
}
const botones = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data.custom_id));
const textoEmbed = (payload) => `${payload.embeds[0].data.title ?? ""} ${payload.embeds[0].data.description ?? ""}`;

beforeEach(() => {
    db.prepare("DELETE FROM duende_perfiles").run();
    perfiles.guardarDescripcion({ discordId: "u1", username: "alex", nombre: "Alex", descripcion: "Fan del Betis" });
    perfiles.guardarDescripcion({ discordId: "raul-id", username: "raul", nombre: "Raúl", descripcion: "Pierde siempre al pádel" });
});

describe("/duende abre el panel", () => {
    test("muestra Hablar, Recuerdos y Personalidad; los admins ven además añadir y quitar", async () => {
        const normal = panel();
        await duende.run(null, { ...normal, options: {} });
        const pn = normal.reply.mock.calls[0][0];
        expect(pn.flags).toBe(MessageFlags.Ephemeral);
        expect(botones(pn)).toEqual(["duendepanel_hablar", "duendepanel_recuerdos", "duendepanel_personalidad"]);

        const admin = panel({ admin: true });
        await duende.run(null, { ...admin, options: {} });
        expect(botones(admin.reply.mock.calls[0][0])).toEqual(expect.arrayContaining(["duendepanel_add", "duendepanel_quitar"]));
    });
});

describe("🧠 Recuerdos", () => {
    test("muestra lo que recuerda de uno mismo", async () => {
        const i = panel({ customId: "duendepanel_recuerdos" });
        await duende.handleButton(null, i);
        expect(textoEmbed(i.update.mock.calls[0][0])).toMatch(/Fan del Betis/);
        expect(textoEmbed(i.update.mock.calls[0][0])).not.toMatch(/pádel/);
    });

    test("un admin elige a otra persona con el selector y ve sus recuerdos", async () => {
        const i = panel({ admin: true, customId: "duendepanel_persona", usersFirst: raul });
        await duende.handleUserSelect(null, i);
        expect(textoEmbed(i.update.mock.calls[0][0])).toMatch(/pádel/);
    });

    test("quien no es admin no puede elegir a otra persona", async () => {
        const i = panel({ customId: "duendepanel_persona", usersFirst: raul });
        await duende.handleUserSelect(null, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/Solo los administradores/);
    });

    test("anotar abre el formulario, y al enviarlo guarda la nota por Discord ID", async () => {
        const abrir = panel({ customId: "duendepanel_anotar_u1" });
        await duende.handleButton(null, abrir);
        expect(abrir.showModal).toHaveBeenCalledTimes(1);

        const enviar = panel({ customId: "duendepanel_modal_anotar_u1", nota: "odia los lunes" });
        await duende.handleModal(null, enviar);
        expect(enviar.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Anotado sobre \*\*alex\*\*/);
        expect(perfiles.perfilDe({ id: "u1", username: "alex_nuevo" }).notas).toEqual(["odia los lunes"]);
    });

    test("quien no es admin no puede anotar ni olvidar lo de otra persona", async () => {
        const anotar = panel({ customId: "duendepanel_anotar_raul-id" });
        await duende.handleButton(null, anotar);
        expect(anotar.showModal).not.toHaveBeenCalled();
        expect(anotar.reply.mock.calls[0][0].content).toMatch(/Solo puedes gestionar lo que recuerdo de ti/);

        const olvidar = panel({ customId: "duendepanel_olvidar_raul-id" });
        await duende.handleButton(null, olvidar);
        expect(olvidar.update).not.toHaveBeenCalled();
        expect(perfiles.perfilPorDiscordId("raul-id").description).toBe("Pierde siempre al pádel");
    });

    test("olvidar borra las notas y conserva el perfil base", async () => {
        perfiles.anotar({ id: "u1", username: "alex" }, "le gusta el pádel");
        const i = panel({ customId: "duendepanel_olvidar_u1" });
        await duende.handleButton(null, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Olvidadas 1 notas/);
        expect(perfiles.perfilPorDiscordId("u1")).toMatchObject({ description: "Fan del Betis", notas: [] });
    });
});

describe("🎭 Personalidad", () => {
    beforeEach(() => {
        db.prepare("DELETE FROM duende_canales").run();
        db.prepare("DELETE FROM duende_personalidades").run();
        perfiles.guardarPersonalidad({ id: "pirata", title: "Pirata", systemInstructions: "Habla como un pirata." });
    });

    test("cualquiera ve la personalidad del canal, pero solo un admin la puede cambiar", async () => {
        const ver = panel({ customId: "duendepanel_personalidad" });
        await duende.handleButton(null, ver);
        expect(textoEmbed(ver.update.mock.calls[0][0])).toMatch(/Pirata/);
        expect(ver.update.mock.calls[0][0].components.flatMap((r) => r.components.map((c) => c.data.custom_id))).not.toContain(
            "duendepanel_canal",
        );

        const sinPermiso = panel({ customId: "duendepanel_canal", values: ["pirata"] });
        await duende.handleSelect(null, sinPermiso);
        expect(perfiles.personalidadDeCanal("canal-1")).toBeNull();
    });

    test("un admin elige la personalidad del canal desde el menú", async () => {
        const i = panel({ admin: true, customId: "duendepanel_canal", values: ["pirata"] });
        await duende.handleSelect(null, i);
        expect(perfiles.personalidadDeCanal("canal-1")).toBe("pirata");
        expect(i.update).toHaveBeenCalledTimes(1);
    });

    test("un admin añade una personalidad con el formulario", async () => {
        const i = panel({
            admin: true,
            customId: "duendepanel_modal_add",
            fields: { id: "poeta", title: "Poeta", systeminstructions: "Habla en verso." },
        });
        await duende.handleModal(null, i);
        expect(perfiles.obtenerPersonalidad("poeta")).toMatchObject({ title: "Poeta", systemInstructions: "Habla en verso." });
    });

    test("un ID con espacios no se guarda", async () => {
        const i = panel({
            admin: true,
            customId: "duendepanel_modal_add",
            fields: { id: "mal id", title: "x", systeminstructions: "y" },
        });
        await duende.handleModal(null, i);
        expect(perfiles.obtenerPersonalidad("mal id")).toBeNull();
    });

    test("un admin quita una personalidad desde el menú", async () => {
        const i = panel({ admin: true, customId: "duendepanel_quitar_select", values: ["pirata"] });
        await duende.handleSelect(null, i);
        expect(perfiles.obtenerPersonalidad("pirata")).toBeNull();
    });

    test("quien no es admin no puede añadir ni quitar", async () => {
        const anadir = panel({ customId: "duendepanel_add" });
        await duende.handleButton(null, anadir);
        expect(anadir.showModal).not.toHaveBeenCalled();

        const quitar = panel({ customId: "duendepanel_quitar_select", values: ["pirata"] });
        await duende.handleSelect(null, quitar);
        expect(perfiles.obtenerPersonalidad("pirata")).not.toBeNull();
    });
});

describe("💬 Hablar", () => {
    test("el botón abre el formulario con el texto", async () => {
        const i = panel({ customId: "duendepanel_hablar" });
        await duende.handleButton(null, i);
        expect(i.showModal).toHaveBeenCalledTimes(1);
        expect(i.showModal.mock.calls[0][0].data.custom_id).toBe("duendepanel_modal_hablar");
    });
});
