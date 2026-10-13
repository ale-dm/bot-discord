// #430: /presentacion. Una frase de hasta 150 caracteres que sale en 👤 Perfil; vacía, se borra; más larga, se rechaza; el
// botón de editar solo está en el perfil propio; y el texto sale escapado para que una mención no avise a nadie.
const db = require("../src/core/db");
const presentaciones = require("../src/systems/presentaciones");
const presentacion = require("../src/commands/general/presentacion");
const perfilPanel = require("../src/paneles/perfil");

const G = "guild-presentacion";
const guild = {
    id: G,
    name: G,
    members: { cache: new Map(), fetch: async () => null },
    channels: { cache: new Map(), fetch: async () => null },
    roles: { cache: new Map() },
    iconURL: () => null,
};
const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const campos = (payload) => payload.embeds[0].toJSON().fields || [];

beforeEach(() => db.prepare("DELETE FROM presentaciones").run());

describe("guardar", () => {
    test("guarda hasta 150 caracteres, limpia espacios y saltos de línea, y la actualiza", () => {
        expect(presentaciones.guardar("p1", "  Betis,   cine\nde terror ")).toEqual({ ok: true, texto: "Betis, cine de terror" });
        expect(presentaciones.obtener("p1")).toBe("Betis, cine de terror");
        presentaciones.guardar("p1", "x".repeat(150));
        expect(presentaciones.obtener("p1")).toHaveLength(150);
    });

    test("un texto vacío la borra", () => {
        presentaciones.guardar("p2", "hola");
        expect(presentaciones.guardar("p2", "   ")).toEqual({ ok: true, texto: null });
        expect(presentaciones.obtener("p2")).toBeNull();
    });

    test("más de 150 caracteres se rechaza, con el límite en el mensaje, y no toca lo que había", () => {
        presentaciones.guardar("p3", "la de antes");
        const r = presentaciones.guardar("p3", "y".repeat(151));
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/150/);
        expect(presentaciones.obtener("p3")).toBe("la de antes");
    });
});

describe("el formulario", () => {
    const interaccion = (userId, texto = "") => ({
        customId: "presentacion_modal",
        user: { id: userId },
        fields: { getTextInputValue: () => texto },
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    });

    test("/presentacion abre un formulario de 150 caracteres con lo que ya había", async () => {
        presentaciones.guardar("f1", "mi frase");
        const i = interaccion("f1");
        await presentacion.run({}, i);
        const campo = i.showModal.mock.calls[0][0].components[0].components[0].data;
        expect(campo).toMatchObject({ custom_id: "texto", max_length: 150, required: false, value: "mi frase" });
    });

    test("al enviarlo guarda; vacío, borra; demasiado largo, avisa del límite", async () => {
        const a = interaccion("f2", "hola mundo");
        await presentacion.handleModal({}, a);
        expect(presentaciones.obtener("f2")).toBe("hola mundo");
        expect(a.reply.mock.calls[0][0].content).toMatch(/guardada/);

        const b = interaccion("f2", "");
        await presentacion.handleModal({}, b);
        expect(presentaciones.obtener("f2")).toBeNull();
        expect(b.reply.mock.calls[0][0].content).toMatch(/borrada/);

        const c = interaccion("f2", "z".repeat(200));
        await presentacion.handleModal({}, c);
        expect(c.reply.mock.calls[0][0].content).toMatch(/150/);
        expect(presentaciones.obtener("f2")).toBeNull();
    });

    test("el botón ✏️ solo abre el formulario a su dueño", async () => {
        const suyo = interaccion("dueno");
        suyo.customId = "presentacion_editar_dueno";
        await presentacion.handleButton({}, suyo);
        expect(suyo.showModal).toHaveBeenCalledTimes(1);

        const ajeno = interaccion("otro");
        ajeno.customId = "presentacion_editar_dueno";
        await presentacion.handleButton({}, ajeno);
        expect(ajeno.showModal).not.toHaveBeenCalled();
        expect(ajeno.reply.mock.calls[0][0].content).toMatch(/Solo puedes editar tu propia/);
    });
});

describe("en el perfil", () => {
    test("otra persona ve la presentación, y el botón de editar solo sale en el perfil propio", async () => {
        presentaciones.guardar("ana", "Betis y cine de terror");
        const ajeno = await perfilPanel.buildPerfil(guild, "luis", "ana");
        expect(campos(ajeno).find((f) => f.name === "💬 Presentación").value).toBe("Betis y cine de terror");
        expect(ids(ajeno)).not.toContain("presentacion_editar_luis");
        expect(ids(ajeno).some((id) => id.startsWith("presentacion_editar_"))).toBe(false);

        const propio = await perfilPanel.buildPerfil(guild, "ana", "ana");
        expect(ids(propio)).toContain("presentacion_editar_ana");
    });

    test("sin presentación, no sale el campo", async () => {
        const p = await perfilPanel.buildPerfil(guild, "luis", "sin-frase");
        expect(campos(p).some((f) => f.name === "💬 Presentación")).toBe(false);
    });

    test("una mención no avisa a nadie: sale escapada", async () => {
        presentaciones.guardar("ana", "hola @everyone y @here <@123>");
        const p = await perfilPanel.buildPerfil(guild, "luis", "ana");
        const valor = campos(p).find((f) => f.name === "💬 Presentación").value;
        expect(valor).not.toContain("@everyone");
        expect(valor).not.toContain("@here");
        expect(valor).not.toContain("<@123>");
        expect(valor.replace(/\u200b/g, "")).toBe("hola @everyone y @here <@123>");
        expect(presentaciones.escapar("@everyone")).toBe("@\u200beveryone");
    });
});
