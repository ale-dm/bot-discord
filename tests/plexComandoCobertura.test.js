// /plex (comando): los botones del panel de Plex (sesión de cine, para ti, pedir en Seerr, Wrapped, Mi Plex) y los
// botones de las sesiones de cine (apuntarse, salirse, cancelar con permiso). Recomendaciones, Seerr, Tautulli y el
// perfil se sustituyen por espías: aquí no hay red. Las sesiones de cine son reales, en la BD en memoria.
const { AttachmentBuilder } = require("discord.js");
const db = require("../src/core/db");
const cine = require("../src/systems/cine");
const plexLinks = require("../src/systems/plexLinks");
const recomendaciones = require("../src/systems/recomendaciones");
const plexWrapped = require("../src/systems/plexWrapped");
const perfilPaneles = require("../src/paneles/perfil");
const plex = require("../src/commands/plex/plex");

const G = "g-plex-btn";
const EFIMERO = 64;
const MANAGE_GUILD = { memberPermissions: { has: (p) => p === "ManageGuild" } };
const SIN_PERMISOS = { memberPermissions: { has: () => false } };

beforeEach(() => {
    db.prepare("DELETE FROM cine_asistentes").run();
    db.prepare("DELETE FROM cine_sesiones").run();
});

afterEach(() => {
    jest.restoreAllMocks();
});

function interaccion(customId, extra = {}) {
    return {
        customId,
        guildId: G,
        channelId: "canal-plex",
        user: { id: "ana", username: "ana", tag: "ana#0001" },
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...SIN_PERMISOS,
        ...extra,
    };
}

function sesionDeCine(organizador = "ana") {
    return cine.crear({ guildId: G, canalId: "canal-plex", organizador, peli: "Dune", inicio: Date.now() + 3600_000 });
}

describe("definición y /plex", () => {
    test("el comando es plex, y sus botones cuelgan de plex_, cine_ y recomendar_pedir_", () => {
        expect(plex.data.name).toBe("plex");
        expect(plex.componentHandlers.map((h) => h.prefixes)).toEqual([["plex_", "cine_", "recomendar_pedir_"], ["plex_modal_"]]);
    });

    test("/plex responde en privado con el panel", async () => {
        const i = interaccion(null);
        await plex.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(EFIMERO);
        expect(payload.embeds[0].data.title).toBe("🍿 Plex");
    });
});

describe("botones del panel", () => {
    test("🎬 Sesión de cine abre el formulario con la película y la hora", async () => {
        const i = interaccion("plex_cine");
        await plex.handleButton({}, i);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe("plex_modal_cine");
        const filas = modal.toJSON().components.map((f) => (f.component ? f.component.custom_id : f.components[0].custom_id));
        expect(filas).toEqual(["peli", "hora", "minuto"]);
    });

    test("🎯 Para ti muestra las recomendaciones, o el motivo si no se pueden dar", async () => {
        const generar = jest
            .spyOn(recomendaciones, "generar")
            .mockResolvedValue({ ok: false, motivo: "Tu cuenta de Plex no está vinculada.", sugerencias: [] });
        const i = interaccion("plex_para_ti");
        await plex.handleButton({}, i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: EFIMERO });
        expect(generar).toHaveBeenCalledWith(G, "ana");
        expect(i.editReply.mock.calls[0][0].embeds[0].data.description).toBe("Tu cuenta de Plex no está vinculada.");
    });

    test("🎯 Para ti sin nada nuevo que recomendar lo dice", async () => {
        jest.spyOn(recomendaciones, "generar").mockResolvedValue({ ok: true, sugerencias: [] });
        const i = interaccion("plex_para_ti");
        await plex.handleButton({}, i);
        expect(i.editReply.mock.calls[0][0].embeds[0].data.description).toMatch(/nada nuevo que recomendarte/);
    });

    test("pedir una recomendación en Seerr confirma el pedido en privado", async () => {
        const pedir = jest.spyOn(recomendaciones, "pedir").mockResolvedValue({ ok: true });
        const i = interaccion("recomendar_pedir_movie_603");
        await plex.handleButton({}, i);
        expect(pedir).toHaveBeenCalledWith(G, "ana", "movie", "603");
        expect(i.editReply).toHaveBeenCalledWith({ content: "✅ Pedido en Seerr. Te avisaremos cuando esté en Plex." });
    });

    test("si Seerr no puede hacer el pedido, se muestra el motivo", async () => {
        jest.spyOn(recomendaciones, "pedir").mockResolvedValue({ ok: false, mensaje: "No encuentro tu perfil de Seerr." });
        const i = interaccion("recomendar_pedir_tv_1399");
        await plex.handleButton({}, i);
        expect(i.editReply).toHaveBeenCalledWith({ content: "❌ No encuentro tu perfil de Seerr." });
    });

    test("un pedido con un tipo que no es película ni serie no hace nada", async () => {
        const pedir = jest.spyOn(recomendaciones, "pedir");
        const i = interaccion("recomendar_pedir_music_1");
        await plex.handleButton({}, i);
        expect(pedir).not.toHaveBeenCalled();
        expect(i.deferReply).not.toHaveBeenCalled();
    });

    test("🏅 Mi Plex usa el perfil de Plex de quien lo pide", async () => {
        const build = jest.spyOn(perfilPaneles, "buildPlex").mockReturnValue({ content: "perfil de Plex" });
        const i = interaccion("plex_perfil");
        await plex.handleButton({}, i);
        expect(build).toHaveBeenCalledWith(undefined, "ana", "ana");
        expect(i.editReply).toHaveBeenCalledWith({ content: "perfil de Plex" });
    });

    test("🎞️ Wrapped sin cuenta de Plex vinculada lo explica, en privado", async () => {
        jest.spyOn(plexLinks, "getLinkByDiscordId").mockReturnValue(null);
        const i = interaccion("plex_wrapped");
        await plex.handleButton({}, i);
        expect(i.editReply).toHaveBeenCalledWith("Tu cuenta de Plex no está vinculada: el Wrapped es para quien la tiene vinculada.");
    });

    test("🎞️ Wrapped con cuenta vinculada manda el resumen y, si hay gráfico, la imagen adjunta", async () => {
        jest.spyOn(plexLinks, "getLinkByDiscordId").mockReturnValue({ tautulliUserId: "99" });
        jest.spyOn(plexWrapped, "mesAnterior").mockReturnValue("2026-09");
        const resumen = { horas: 12 };
        const resumenPersonal = jest.spyOn(plexWrapped, "resumenPersonal").mockReturnValue(resumen);
        jest.spyOn(plexWrapped, "graficoPersonal").mockReturnValue(Buffer.from("png"));
        jest.spyOn(plexWrapped, "mensajePersonal").mockReturnValue("Has visto 12 horas.");
        const i = interaccion("plex_wrapped");
        await plex.handleButton({}, i);
        expect(resumenPersonal).toHaveBeenCalledWith(G, "99", "2026-09");
        const edicion = i.editReply.mock.calls[0][0];
        expect(edicion.content).toBe("Has visto 12 horas.");
        expect(edicion.files).toHaveLength(1);
        expect(edicion.files[0]).toBeInstanceOf(AttachmentBuilder);
        expect(edicion.files[0].name).toBe("wrapped.png");
    });

    test("🎞️ Wrapped sin gráfico manda solo el texto, sin archivos", async () => {
        jest.spyOn(plexLinks, "getLinkByDiscordId").mockReturnValue({ tautulliUserId: "99" });
        jest.spyOn(plexWrapped, "resumenPersonal").mockReturnValue({});
        jest.spyOn(plexWrapped, "graficoPersonal").mockReturnValue(null);
        jest.spyOn(plexWrapped, "mensajePersonal").mockReturnValue("Poco que contar.");
        const i = interaccion("plex_wrapped");
        await plex.handleButton({}, i);
        expect(i.editReply.mock.calls[0][0]).toEqual({ content: "Poco que contar.", files: [] });
    });

    test("un botón de plex_ que no existe no hace nada", async () => {
        const i = interaccion("plex_inventado");
        const r = await plex.handleButton({}, i);
        expect(r).toBeUndefined();
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });
});

describe("formulario de la sesión de cine", () => {
    test("una hora válida crea la sesión y guarda el mensaje público", async () => {
        const i = interaccion(null, {
            customId: "plex_modal_cine",
            channelId: "canal-cine",
            fields: { getTextInputValue: () => "  Alien  ", getStringSelectValues: (id) => ({ hora: ["23"], minuto: ["59"] })[id] },
            fetchReply: jest.fn(async () => ({ id: "msg-7" })),
        });
        await plex.handleModal({}, i);
        const fila = db.prepare("SELECT peli, organizador, mensajeId FROM cine_sesiones WHERE guildId = ?").get(G);
        expect(fila).toMatchObject({ peli: "Alien", organizador: "ana", mensajeId: "msg-7" });
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toBe("🎬 Alien");
    });

    test("un id de modal que no es el de cine no hace nada", async () => {
        const i = interaccion(null, { customId: "plex_otro_modal" });
        await plex.handleModal({}, i);
        expect(i.reply).not.toHaveBeenCalled();
    });
});

describe("botones de una sesión de cine", () => {
    test("apuntarse añade a quien pulsa y actualiza el mensaje", async () => {
        const id = sesionDeCine("ana");
        const i = interaccion(`cine_apuntarse_${id}`, { user: { id: "bea", username: "bea" } });
        await plex.handleButton({}, i);
        expect(cine.asistentes(id)).toEqual(expect.arrayContaining(["ana", "bea"]));
        expect(i.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Apuntados \(2\)/);
    });

    test("salirse quita a quien pulsa y actualiza el mensaje", async () => {
        const id = sesionDeCine("ana");
        cine.apuntar(id, "bea");
        const i = interaccion(`cine_salirse_${id}`, { user: { id: "bea", username: "bea" } });
        await plex.handleButton({}, i);
        expect(cine.asistentes(id)).toEqual(["ana"]);
        expect(i.update).toHaveBeenCalled();
    });

    test("apuntarse a una sesión cancelada se rechaza en privado", async () => {
        const id = sesionDeCine("ana");
        cine.cancelar(id, "ana");
        const i = interaccion(`cine_apuntarse_${id}`, { user: { id: "bea", username: "bea" } });
        await plex.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Esa sesión está cancelada.", flags: EFIMERO });
        expect(cine.asistentes(id)).toEqual(["ana"]);
    });

    test("una sesión que ya no existe se dice en privado", async () => {
        const i = interaccion("cine_apuntarse_999999");
        await plex.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Esa sesión ya no existe.", flags: EFIMERO });
    });

    test("cancelar sin ser quien la convocó ni tener ManageGuild se rechaza", async () => {
        const id = sesionDeCine("ana");
        const i = interaccion(`cine_cancelar_${id}`, { user: { id: "bea", username: "bea" } });
        await plex.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Solo quien la convocó o un admin puede cancelarla.", flags: EFIMERO });
        expect(cine.sesion(id).cancelada).toBeFalsy();
    });

    test("quien gestiona el servidor (ManageGuild) puede cancelar la sesión de otra persona", async () => {
        const id = sesionDeCine("ana");
        const i = interaccion(`cine_cancelar_${id}`, { user: { id: "mod", username: "mod" }, ...MANAGE_GUILD });
        await plex.handleButton({}, i);
        expect(i.update).toHaveBeenCalled();
        expect(cine.sesion(id).cancelada).toBeTruthy();
    });

    test("quien convocó la sesión puede cancelarla", async () => {
        const id = sesionDeCine("ana");
        const i = interaccion(`cine_cancelar_${id}`);
        await plex.handleButton({}, i);
        expect(i.update).toHaveBeenCalled();
        expect(cine.sesion(id).cancelada).toBeTruthy();
    });
});
