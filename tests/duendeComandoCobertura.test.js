// /duende (fachada del comando): el panel que se abre con /duende, las rutas de sus botones (recuerdo_auto_ y
// duendepanel_), y que las acciones del panel (src/paneles/duendeAcciones.js) se reexportan tal cual. El chat real
// (services/duende/chat) y los recuerdos automáticos se sustituyen por espías; la BD es la de los tests.
const recuerdosAuto = require("../src/systems/duende/recuerdosAuto");
const perfiles = require("../src/systems/duende/perfiles");
const acciones = require("../src/paneles/duendeAcciones");
const chat = require("../src/services/duende/chat/hablar");
const duende = require("../src/commands/duende/duende");

const EFIMERO = 64;
const ADMIN = { memberPermissions: { has: (p) => p === "Administrator" } };
const NO_ADMIN = { memberPermissions: { has: () => false } };

afterEach(() => {
    jest.restoreAllMocks();
});

function interaccion(extra = {}) {
    return {
        customId: "",
        channelId: "canal-duende",
        guildId: "g-duende",
        user: { id: "ana", username: "ana", tag: "ana#0001" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        isFromMessage: () => false,
        ...ADMIN,
        ...extra,
    };
}

describe("definición del comando", () => {
    test("se llama duende y los componentes cuelgan de recuerdo_auto_ y duendepanel_", () => {
        expect(duende.data.name).toBe("duende");
        const rutas = duende.componentHandlers.map((h) => [h.types[0], h.prefixes[0], h.method]);
        expect(rutas).toEqual([
            ["button", "recuerdo_auto_", "handleRecuerdoAuto"],
            ["button", "duendepanel_", "handleButton"],
            ["stringSelect", "duendepanel_", "handleSelect"],
            ["userSelect", "duendepanel_", "handleUserSelect"],
            ["modal", "duendepanel_", "handleModal"],
        ]);
    });

    test("el chat y las acciones del panel se reexportan desde el propio comando", () => {
        expect(duende.hablar).toBe(chat.hablar);
        expect(duende.handleButton).toBe(acciones.handleButton);
        expect(duende.handleSelect).toBe(acciones.handleSelect);
        expect(duende.handleUserSelect).toBe(acciones.handleUserSelect);
        expect(duende.handleModal).toBe(acciones.handleModal);
    });
});

describe("/duende abre el panel", () => {
    test("responde en privado con la pantalla de inicio", async () => {
        const i = interaccion();
        await duende.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(EFIMERO);
        expect(payload.embeds[0].data.title).toBe("🤖 El Duende");
        expect(payload.embeds[0].data.description).toMatch(/Como admin/);
    });

    test("sin ser admin no se ofrecen las personalidades en la descripción", async () => {
        const i = interaccion(NO_ADMIN);
        await duende.run({}, i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.description).not.toMatch(/Como admin/);
    });

    test("muestra la personalidad que tenga asignada el canal", async () => {
        perfiles.guardarPersonalidad({ id: "gruñon", title: "Duende gruñón", systemInstructions: "Eres un duende gruñón." });
        perfiles.asignarPersonalidadCanal("canal-duende", "gruñon");
        const i = interaccion();
        await duende.run({}, i);
        const campo = i.reply.mock.calls[0][0].embeds[0].data.fields[0];
        expect(campo.value).toBe("Duende gruñón");
    });
});

describe("recuerdos automáticos (recuerdo_auto_ok|no_N)", () => {
    test("guardar la propuesta confirma y quita los botones", async () => {
        const resolver = jest.spyOn(recuerdosAuto, "resolver").mockReturnValue({ ok: true, mensaje: "🧠 Guardado." });
        const i = interaccion({ customId: "recuerdo_auto_ok_42" });
        await duende.handleRecuerdoAuto({}, i);
        expect(resolver).toHaveBeenCalledWith("42", "ana", true);
        expect(i.update).toHaveBeenCalledWith({ content: "🧠 Guardado.", embeds: [], components: [] });
    });

    test("descartar la propuesta pasa la decisión como no", async () => {
        const resolver = jest.spyOn(recuerdosAuto, "resolver").mockReturnValue({ ok: true, mensaje: "Descartado." });
        const i = interaccion({ customId: "recuerdo_auto_no_7" });
        await duende.handleRecuerdoAuto({}, i);
        expect(resolver).toHaveBeenCalledWith("7", "ana", false);
        expect(i.update.mock.calls[0][0].content).toBe("Descartado.");
    });

    test("si la propuesta ya no vale, se avisa en privado con el motivo", async () => {
        jest.spyOn(recuerdosAuto, "resolver").mockReturnValue({ ok: false, mensaje: "Esa propuesta ya se resolvió." });
        const i = interaccion({ customId: "recuerdo_auto_ok_3" });
        await duende.handleRecuerdoAuto({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "⚠️ Esa propuesta ya se resolvió.", flags: EFIMERO });
        expect(i.update).not.toHaveBeenCalled();
    });

    test("un id de botón con otra forma no se trata aquí", async () => {
        const resolver = jest.spyOn(recuerdosAuto, "resolver");
        const i = interaccion({ customId: "recuerdo_auto_quizas_3" });
        const r = await duende.handleRecuerdoAuto({}, i);
        expect(r).toBeUndefined();
        expect(resolver).not.toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });
});

describe("las acciones del panel llegan por la fachada", () => {
    test("el botón de inicio vuelve a la pantalla de inicio", async () => {
        const i = interaccion({ customId: "duendepanel_inicio" });
        await duende.handleButton({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toBe("🤖 El Duende");
    });

    test("un usuario sin permiso no puede añadir personalidades", async () => {
        const i = interaccion({ customId: "duendepanel_add", ...NO_ADMIN });
        await duende.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "⛔ Solo los administradores pueden hacer esto.", flags: EFIMERO });
        expect(i.showModal).not.toHaveBeenCalled();
    });

    test("un admin ve el formulario para añadir una personalidad", async () => {
        const i = interaccion({ customId: "duendepanel_add" });
        await duende.handleButton({}, i);
        expect(i.showModal.mock.calls[0][0].data.custom_id).toBe("duendepanel_modal_add");
    });

    test("un usuario sin permiso no puede cambiar la personalidad de un canal por el menú", async () => {
        const i = interaccion({ customId: "duendepanel_canal", values: ["gruñon"], ...NO_ADMIN });
        await duende.handleSelect({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "⛔ Solo los administradores pueden hacer esto.", flags: EFIMERO });
    });

    test("un usuario sin permiso no puede elegir persona en el selector de recuerdos", async () => {
        const i = interaccion({ customId: "duendepanel_persona", ...NO_ADMIN });
        await duende.handleUserSelect({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "⛔ Solo los administradores pueden hacer esto.", flags: EFIMERO });
    });

    test("el formulario de añadir sin permiso no guarda nada", async () => {
        const guardar = jest.spyOn(perfiles, "guardarPersonalidad");
        const i = interaccion({ customId: "duendepanel_modal_add", ...NO_ADMIN });
        await duende.handleModal({}, i);
        expect(guardar).not.toHaveBeenCalled();
        expect(i.reply).toHaveBeenCalledWith({ content: "⛔ Solo los administradores pueden hacer esto.", flags: EFIMERO });
    });
});
