// Formularios de /paneladmin → Plex (#239, cobertura): importación, trofeo nuevo, quitar canal y vincular una cuenta.
// Los módulos de Plex, Tautulli y la auditoría están simulados con spies; lo que se prueba es qué se pide, qué se
// responde y qué pasa con los datos que no encajan.
const { handlePlexModal } = require("../src/adminPanel/plex/modales");
const plexLinks = require("../src/systems/plexLinks");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const achievements = require("../src/systems/achievementsSystem");
const tautulliClient = require("../src/services/tautulliClient");
const guildSettings = require("../src/systems/guildSettings");
const adminAudit = require("../src/systems/adminAudit");

function formulario(valores = {}) {
    return {
        getStringSelectValues: () => [],
        getTextInputValue: jest.fn((campo) => {
            if (!(campo in valores)) throw new Error(`campo ${campo} no existe`);
            return valores[campo];
        }),
    };
}

function interaccion({ customId, valores = {}, guildId = "g-plex-modales", canal = null } = {}) {
    return {
        customId,
        guildId,
        guild: { id: guildId },
        user: { id: "admin-1", tag: "admin#0001" },
        fields: { ...formulario(valores), getSelectedChannels: () => (canal ? new Map([[canal, {}]]) : null) },
        reply: jest.fn(async () => {}),
    };
}

const ultimoTexto = (i) => i.reply.mock.calls.at(-1)[0].content;

beforeEach(() => {
    jest.spyOn(adminAudit, "logAdminAction").mockImplementation(() => {});
    jest.spyOn(guildSettings, "setSetting").mockImplementation(() => {});
    jest.spyOn(achievements, "porcentajeImportacion").mockReturnValue(20);
    jest.spyOn(plexLinks, "setLink").mockImplementation(() => {});
    jest.spyOn(tautulliClient, "removeAllowedChannel").mockImplementation(() => {});
    jest.spyOn(plexHistorial, "actualizarLogros").mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("ruta del formulario", () => {
    test("un formulario que no es de Plex no lo gestiona", async () => {
        const i = interaccion({ customId: "paneladmin_otra_cosa" });
        expect(await handlePlexModal(i)).toBe(false);
        expect(i.reply).not.toHaveBeenCalled();
    });
});

describe("porcentaje de la importación", () => {
    test("un valor fuera de 0-100 o que no es número se rechaza sin guardar nada", async () => {
        for (const pct of ["abc", "101", "-5", "1.5"]) {
            const i = interaccion({ customId: "paneladmin_plex_importacion_modal", valores: { pct } });
            await handlePlexModal(i);
            expect(ultimoTexto(i)).toBe("❌ Tiene que ser un número de 0 a 100.");
        }
        expect(guildSettings.setSetting).not.toHaveBeenCalled();
    });

    test("un porcentaje válido se guarda, se audita y se confirma con el valor anterior", async () => {
        const i = interaccion({ customId: "paneladmin_plex_importacion_modal", valores: { pct: "50 %" } });
        await handlePlexModal(i);
        expect(guildSettings.setSetting).toHaveBeenCalledWith("g-plex-modales", "plex.importacion_pct", 50);
        expect(adminAudit.logAdminAction).toHaveBeenCalledWith(
            expect.objectContaining({ action: "plex.importacion.pct", details: { antes: 20, ahora: 50 } }),
        );
        expect(ultimoTexto(i)).toContain("el **50 %**");
        expect(ultimoTexto(i)).toContain("antes, el 20 %");
    });
});

describe("trofeo nuevo", () => {
    test("si el trofeo no es válido, se explica el motivo", async () => {
        jest.spyOn(plexTrofeos, "crearAdmin").mockReturnValue({ ok: false, error: "La condición no existe." });
        const i = interaccion({
            customId: "paneladmin_plex_trofeo_modal",
            valores: { nombre: "X", condicion: "nada", recompensa: "10", descripcion: "d", dificultad: "facil" },
        });
        await handlePlexModal(i);
        expect(ultimoTexto(i)).toBe("❌ La condición no existe.");
        expect(adminAudit.logAdminAction).not.toHaveBeenCalled();
    });

    test("un trofeo válido se crea, se audita y se calcula al momento", async () => {
        jest.spyOn(plexTrofeos, "crearAdmin").mockReturnValue({
            ok: true,
            trofeo: {
                id: 7,
                nombre: "Maratón",
                condicion: "temporadas",
                recompensa: 1500,
                descripcion: "Ver muchas",
                dificultad: "normal",
            },
        });
        const i = interaccion({
            customId: "paneladmin_plex_trofeo_modal",
            valores: { nombre: "Maratón", condicion: "temporadas", recompensa: "1500", descripcion: "Ver muchas", dificultad: "normal" },
        });
        await handlePlexModal(i);
        expect(adminAudit.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "plex.trofeo.crear" }));
        expect(ultimoTexto(i)).toContain("Trofeo **Maratón** creado");
        expect(plexHistorial.actualizarLogros).toHaveBeenCalledWith(expect.anything());
    });

    test("si el cálculo del trofeo falla, se avisa en el log y la respuesta ya ha salido", async () => {
        jest.spyOn(plexTrofeos, "crearAdmin").mockReturnValue({
            ok: true,
            trofeo: { id: 8, nombre: "T", condicion: "c", recompensa: 1, descripcion: "d", dificultad: "facil" },
        });
        plexHistorial.actualizarLogros.mockRejectedValue(new Error("Tautulli caído"));
        const i = interaccion({ customId: "paneladmin_plex_trofeo_modal", valores: { nombre: "T" } });
        await expect(handlePlexModal(i)).resolves.toBe(true);
        expect(ultimoTexto(i)).toContain("Trofeo **T** creado");
    });

    test("un campo que el formulario no tiene se toma como vacío", async () => {
        const crear = jest.spyOn(plexTrofeos, "crearAdmin").mockReturnValue({ ok: false, error: "falta el nombre" });
        const i = interaccion({ customId: "paneladmin_plex_trofeo_modal", valores: { nombre: "" } });
        await handlePlexModal(i);
        expect(crear.mock.calls[0][1]).toMatchObject({ nombre: "", descripcion: "", dificultad: "" });
    });
});

describe("quitar canal", () => {
    test("sin elegir ningún canal se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_plex_channel_remove_modal" });
        await handlePlexModal(i);
        expect(ultimoTexto(i)).toBe("Elige un canal.");
        expect(tautulliClient.removeAllowedChannel).not.toHaveBeenCalled();
    });

    test("el canal elegido se quita de la lista y se audita", async () => {
        const i = interaccion({ customId: "paneladmin_plex_channel_remove_modal", canal: "123456789012345678" });
        await handlePlexModal(i);
        expect(tautulliClient.removeAllowedChannel).toHaveBeenCalledWith("g-plex-modales", "123456789012345678");
        expect(adminAudit.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "plex.channels.remove" }));
        expect(ultimoTexto(i)).toBe("✅ Canal quitado de la lista de Plex.");
    });
});

describe("vincular una cuenta de Plex", () => {
    const customId = "paneladmin_plex_link_modal_987654321098765432";

    test("si Tautulli no responde, se dice y no se vincula nada", async () => {
        jest.spyOn(tautulliClient, "getUsers").mockRejectedValue(new Error("timeout"));
        const i = interaccion({ customId, valores: { plex_username: "ana" } });
        await handlePlexModal(i);
        expect(ultimoTexto(i)).toBe("❌ No se pudo consultar Tautulli: timeout");
        expect(plexLinks.setLink).not.toHaveBeenCalled();
    });

    test("si nadie de Tautulli coincide, se pide el nombre exacto", async () => {
        jest.spyOn(tautulliClient, "getUsers").mockResolvedValue([{ user_id: 1, username: "otro", friendly_name: "Otro" }]);
        const i = interaccion({ customId, valores: { plex_username: "ana" } });
        await handlePlexModal(i);
        expect(ultimoTexto(i)).toContain('No encuentro a "ana" en Tautulli');
        expect(plexLinks.setLink).not.toHaveBeenCalled();
    });

    test("coincide por usuario de Plex, sin distinguir mayúsculas, y se vincula", async () => {
        jest.spyOn(tautulliClient, "getUsers").mockResolvedValue([{ user_id: 42, username: "Ana_Plex", friendly_name: "Ana" }]);
        const i = interaccion({ customId, valores: { plex_username: "ana_plex" } });
        await handlePlexModal(i);
        expect(plexLinks.setLink).toHaveBeenCalledWith("g-plex-modales", "987654321098765432", 42, "Ana_Plex");
        expect(ultimoTexto(i)).toBe("✅ <@987654321098765432> vinculado a **Ana_Plex**.");
    });

    test("si la cuenta no tiene usuario de Plex, se vincula por su nombre visible", async () => {
        jest.spyOn(tautulliClient, "getUsers").mockResolvedValue([{ user_id: 43, username: null, friendly_name: "Miriam" }]);
        const i = interaccion({ customId, valores: { plex_username: "miriam" } });
        await handlePlexModal(i);
        expect(plexLinks.setLink).toHaveBeenCalledWith("g-plex-modales", "987654321098765432", 43, "Miriam");
    });
});
