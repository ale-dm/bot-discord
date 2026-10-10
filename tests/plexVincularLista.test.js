// Vincular una cuenta de Plex (adminPanel/plex, #307 grupo G4): el nombre de Tautulli se elige de una lista cuando
// Tautulli responde a tiempo; si no, se escribe como antes.
const { ComponentType } = require("discord.js");
const { handlePlexUserSelect } = require("../src/adminPanel/plex/selects");
const tautulliClient = require("../src/services/tautulliClient");

function interaccion() {
    return {
        customId: "paneladmin_plex_link_select",
        values: ["987654321098765432"],
        guildId: "g-plex-lista",
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

const campoDelModal = (i) => i.showModal.mock.calls[0][0].toJSON().components[0];

afterEach(() => {
    jest.restoreAllMocks();
});

test("con los usuarios de Tautulli, el nombre se elige de un desplegable", async () => {
    jest.spyOn(tautulliClient, "getUsers").mockResolvedValue([
        { user_id: 1, username: "ana", friendly_name: "Ana" },
        { user_id: 2, username: null, friendly_name: "Miriam" },
    ]);
    const i = interaccion();
    await handlePlexUserSelect(i);
    const campo = campoDelModal(i);
    expect(campo.component.type).toBe(ComponentType.StringSelect);
    expect(campo.component.custom_id).toBe("plex_username_lista");
    expect(campo.component.options.map((o) => o.value)).toEqual(["ana", "Miriam"]);
});

test("si Tautulli no responde, se escribe el nombre como antes", async () => {
    jest.spyOn(tautulliClient, "getUsers").mockRejectedValue(new Error("timeout"));
    const i = interaccion();
    await handlePlexUserSelect(i);
    const campo = campoDelModal(i);
    expect(campo.components[0].custom_id).toBe("plex_username");
});

test("con más de 25 usuarios no cabe en un desplegable: se escribe el nombre", async () => {
    const muchos = Array.from({ length: 26 }, (_, n) => ({ user_id: n + 1, username: `u${n}`, friendly_name: `u${n}` }));
    jest.spyOn(tautulliClient, "getUsers").mockResolvedValue(muchos);
    const i = interaccion();
    await handlePlexUserSelect(i);
    expect(campoDelModal(i).components[0].custom_id).toBe("plex_username");
});
