// 🍿 /plex: el panel con los botones de Plex, el aviso de si tu cuenta está vinculada, y la sesión de cine creada desde el
// formulario (con su mensaje público). Seerr, Tautulli y Discord no se llaman: todo va con sustitutos.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const cine = require("../src/systems/cine");
const plex = require("../src/commands/plex/plex");
const { pantallaPlex } = require("../src/paneles/plex");

const G = "g-plex-cmd";

beforeEach(() => {
    db.prepare("DELETE FROM cine_asistentes").run();
    db.prepare("DELETE FROM cine_sesiones").run();
});

test("el panel tiene los cuatro botones de Plex", () => {
    const ids = pantallaPlex(G, "nadie").components[0].components.map((b) => b.data.custom_id);
    expect(ids).toEqual(["plex_cine", "plex_para_ti", "plex_wrapped", "plex_perfil"]);
});

test("avisa si la cuenta de Plex no está vinculada, y dice cuál lo está", () => {
    plexLinks.setLink(G, "disc-ana", "1", "Ana");
    expect(pantallaPlex(G, "disc-ana").embeds[0].data.description).toMatch(/vinculada: \*\*Ana\*\*/);
    expect(pantallaPlex(G, "disc-otro").embeds[0].data.description).toMatch(/no está vinculada/);
});

test("el comando es /plex, y los botones de cine y recomendaciones cuelgan de él", () => {
    expect(plex.data.name).toBe("plex");
    const prefijos = plex.componentHandlers.flatMap((h) => h.prefixes);
    expect(prefijos).toEqual(expect.arrayContaining(["plex_", "cine_", "recomendar_pedir_"]));
});

test("el formulario crea la sesión de cine y responde con su mensaje público", async () => {
    const reply = jest.fn(async () => {});
    const fetchReply = jest.fn(async () => ({ id: "msg-9" }));
    const interaction = {
        customId: "plex_modal_cine",
        guildId: G,
        channelId: "canal-cine",
        user: { id: "ana" },
        fields: { getTextInputValue: (id) => (id === "peli" ? "Dune" : "23:59") },
        reply,
        fetchReply,
    };
    await plex.handleModal(null, interaction);
    const sesion = db.prepare("SELECT * FROM cine_sesiones WHERE guildId = ?").get(G);
    expect(sesion).toMatchObject({ peli: "Dune", organizador: "ana", mensajeId: "msg-9" });
    expect(reply.mock.calls[0][0].embeds[0].data.title).toBe("🎬 Dune");
    expect(cine.asistentes(sesion.id)).toEqual(["ana"]);
});

test("una hora que no vale no crea nada, y lo dice en privado", async () => {
    const reply = jest.fn(async () => {});
    await plex.handleModal(null, {
        customId: "plex_modal_cine",
        guildId: G,
        channelId: "c",
        user: { id: "ana" },
        fields: { getTextInputValue: (id) => (id === "peli" ? "Dune" : "25:00") },
        reply,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM cine_sesiones WHERE guildId = ?").get(G).n).toBe(0);
    expect(reply.mock.calls[0][0].flags).toBeDefined();
});
