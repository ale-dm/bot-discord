// "Ya está en Plex": aviso a quien pidió algo en Seerr cuando pasa a estar disponible (Seerr simulado, sin red).
jest.mock("../src/services/seerrClient", () => ({
    ...jest.requireActual("../src/services/seerrClient"),
    getConfig: jest.fn(() => ({ url: "http://seerr", apiKey: "clave", dailyRequestLimit: 5 })),
    getRequestsRaw: jest.fn(async () => []),
    getUsersDetailed: jest.fn(async () => []),
    getMediaTitle: jest.fn(async (guildId, tipo, tmdbId) => `Título ${tmdbId}`),
}));
const db = require("../src/core/db");
const seerrClient = require("../src/services/seerrClient");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const { avisarDisponibles } = require("../src/systems/pedidosSeerr");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "guild-seerr";
const pedido = (id, estadoCodigo, seerrUserId, extra = {}) => ({
    id,
    mediaType: "movie",
    tmdbId: 1000 + id,
    estadoCodigo,
    seerrUserId,
    plexUsername: null,
    ...extra,
});

function clienteFalso(canal) {
    const dms = [];
    const guild = { id: G, name: "Servidor", channels: { cache: new Map(canal ? [["novedades", canal]] : []), fetch: async () => null } };
    return {
        dms,
        guilds: { cache: new Map([[G, guild]]) },
        users: { fetch: async (id) => ({ id, send: async (payload) => dms.push({ id, payload }) }) },
    };
}
const canalFalso = () => ({ name: "novedades", isTextBased: () => true, send: jest.fn(async () => {}) });

beforeAll(() => {
    guildSettings.setSetting(G, "plex.novedades_channel_id", "novedades");
    seerrClient.getUsersDetailed.mockResolvedValue([
        { id: 1, plexUsername: "raul", discordIds: ["111111111111111111"] },
        { id: 2, plexUsername: "Perro", discordIds: [] },
        { id: 3, plexUsername: "fantasma", discordIds: [] },
    ]);
    plexLinks.setLink(G, "222222222222222222", "7", "perro");
});

test("la primera vez solo fija la base: lo que ya estaba disponible no se avisa", async () => {
    seerrClient.getRequestsRaw.mockResolvedValue([pedido(1, 5, 1), pedido(2, 3, 1)]);
    const canal = canalFalso();
    expect(await avisarDisponibles(clienteFalso(canal))).toBe(0);
    expect(canal.send).not.toHaveBeenCalled();
    expect(db.prepare("SELECT requestId FROM seerr_avisos WHERE guildId = ? ORDER BY requestId").all(G)).toEqual([
        { requestId: 0 },
        { requestId: 1 },
    ]);
});

test("cuando llega algo pedido, se menciona a quien lo pidió en el canal de novedades (una sola vez)", async () => {
    seerrClient.getRequestsRaw.mockResolvedValue([pedido(1, 5, 1), pedido(2, 5, 1), pedido(3, 4, 2, { mediaType: "tv" })]);
    const canal = canalFalso();
    const client = clienteFalso(canal);
    expect(await avisarDisponibles(client)).toBe(2);
    const enviados = canal.send.mock.calls.map((c) => c[0]);
    expect(enviados[0]).toEqual({
        content: "🍿 <@111111111111111111>, lo que pediste ya está en Plex: **Título 1002**.",
        allowedMentions: { users: ["111111111111111111"] },
    });
    // Sin Discord ID en Seerr: por su vínculo de Plex (sin distinguir mayúsculas). Serie a medias: "ya hay episodios".
    expect(enviados[1].content).toMatch(/<@222222222222222222>, ya hay episodios de \*\*Título 1003\*\*/);

    expect(await avisarDisponibles(client)).toBe(0);
    expect(canal.send).toHaveBeenCalledTimes(2);
});

test("de quien no se sabe quién es en Discord no se avisa, y no se reintenta", async () => {
    seerrClient.getRequestsRaw.mockResolvedValue([pedido(4, 5, 3)]);
    const canal = canalFalso();
    expect(await avisarDisponibles(clienteFalso(canal))).toBe(0);
    expect(db.prepare("SELECT 1 FROM seerr_avisos WHERE guildId = ? AND requestId = 4").get(G)).toBeTruthy();
});

test("sin canal de novedades, el aviso va por DM", async () => {
    guildSettings.setSetting(G, "plex.novedades_channel_id", "");
    seerrClient.getRequestsRaw.mockResolvedValue([pedido(5, 5, 1)]);
    const client = clienteFalso(null);
    expect(await avisarDisponibles(client)).toBe(1);
    expect(client.dms).toEqual([{ id: "111111111111111111", payload: { content: expect.stringMatching(/Título 1005/) } }]);
    guildSettings.setSetting(G, "plex.novedades_channel_id", "novedades");
});

test("desactivado en el panel (o sin Seerr configurado) no pregunta a Seerr", async () => {
    seerrClient.getRequestsRaw.mockClear();
    const i = {
        customId: "paneladmin_seerr_avisos",
        guildId: G,
        user: { id: "admin", tag: "admin" },
        member: { permissions: { has: () => true } },
        update: jest.fn(async () => {}),
    };
    await paneladmin.handleButton(null, i);
    expect(guildSettings.getSettings(G).seerr.avisar_disponible).toBe(false);
    expect(i.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Avisar cuando llega lo pedido \("ya está en Plex"\): no/);
    await avisarDisponibles(clienteFalso(canalFalso()));
    expect(seerrClient.getRequestsRaw).not.toHaveBeenCalled();

    guildSettings.setSetting(G, "seerr.avisar_disponible", true);
    seerrClient.getConfig.mockReturnValueOnce({ url: "", apiKey: "" });
    await avisarDisponibles(clienteFalso(canalFalso()));
    expect(seerrClient.getRequestsRaw).not.toHaveBeenCalled();
});
