// 🍿 El Duende conoce los trofeos de Plex (F-PX-02f): la herramienta consultar_trofeos_plex responde "¿qué trofeos de
// Plex tiene X?", "¿quién ha terminado Breaking Bad?" y, sin nada, quién tiene más. Respeta a quien oculta los suyos.
const { Collection } = require("discord.js");
const { nuevoGuild, serie, verEps, vincular } = require("./ayudaPlex");
const guildSettings = require("../src/systems/guildSettings");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const { DUENDE_PLEX_TOOL_DECLARATIONS, DUENDE_TOOL_EXECUTORS: h } = require("../src/services/duende/herramientas");

const G = nuevoGuild("guild-duende-trofeos");
const miembro = (id, username, displayName) => [id, { id, user: { username }, nickname: null, displayName }];
const guild = {
    id: G,
    name: G,
    members: {
        cache: new Collection([
            miembro("disc-1", "ana", "Ana"),
            miembro("disc-2", "luis", "Luis"),
            miembro("disc-3", "carlos", "Carlos"),
            miembro("disc-4", "nadie", "Nadie"),
        ]),
    },
    channels: { cache: new Map(), fetch: async () => null },
};
const ctx = (userId = "disc-1") => ({ guildId: G, guild, userId, channelId: "c" });

beforeAll(async () => {
    delete process.env.GOOGLE_API_KEY;
    guildSettings.setSetting(G, "plex.importacion_pct", 100);
    vincular(G, 1, 2, 3);
    serie(G, "bb", "Breaking Bad", { 1: [1, 2], 2: [1, 2] });
    const entera = [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
    ];
    verEps(G, 1, "bb", "Breaking Bad", entera);
    verEps(G, 2, "bb", "Breaking Bad", entera);
    verEps(G, 3, "bb", "Breaking Bad", entera.slice(0, 2));
    await plexHistorial.actualizarLogros(G);
    plexTrofeos.setOculto(G, "disc-2", true);
});

test("está declarada para Gemini con las de Plex (solo en los canales donde se puede preguntar por Plex)", () => {
    const d = DUENDE_PLEX_TOOL_DECLARATIONS.find((x) => x.name === "consultar_trofeos_plex");
    expect(Object.keys(d.parameters.properties)).toEqual(["persona", "titulo"]);
    expect(d.parameters.required).toBeUndefined();
    expect(typeof h.consultar_trofeos_plex).toBe("function");
});

test("los trofeos de alguien: cuántos, por dificultad, cuáles (con rareza) y los últimos", async () => {
    const r = await h.consultar_trofeos_plex({ persona: "ana" }, ctx("disc-3"));
    expect(r).toMatchObject({ persona: "ana", logros_de_plex_completados: expect.any(Number), sin_reclamar: expect.any(Number) });
    expect(r.logros_de_plex_completados).toBeGreaterThanOrEqual(4);
    expect(r.por_dificultad.facil + r.por_dificultad.normal + r.por_dificultad.gordo_del_plex).toBe(r.logros_de_plex_completados);
    expect(r.trofeos.map((t) => t.de_que_es)).toEqual(
        expect.arrayContaining(["Termina Breaking Bad entera (4 episodios)", "Termina la temporada 1 de Breaking Bad"]),
    );
    // Ana, Luis y Carlos tienen la temporada 1: el 100 %; la serie entera, Ana y Luis (2 de 3).
    expect(r.trofeos.find((t) => t.de_que_es === "Termina la temporada 1 de Breaking Bad").lo_tiene_el_pct_del_servidor).toBe(100);
    expect(r.trofeos.find((t) => t.de_que_es.startsWith("Termina Breaking Bad entera"))).toMatchObject({
        dificultad: "Normal",
        lo_tiene_el_pct_del_servidor: 67,
    });
    expect(r.ultimos_conseguidos[0]).toMatchObject({ nombre: expect.any(String), fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
});

test("quien oculta sus logros de Plex no los enseña a los demás (a sí mismo, sí)", async () => {
    expect(await h.consultar_trofeos_plex({ persona: "luis" }, ctx("disc-1"))).toEqual({
        persona: "luis",
        oculto: true,
        error: "luis tiene sus logros de Plex ocultos.",
    });
    expect((await h.consultar_trofeos_plex({ persona: "luis" }, ctx("disc-2"))).logros_de_plex_completados).toBeGreaterThan(0);
});

test("sin Plex vinculado o sin identificar, lo dice", async () => {
    expect(await h.consultar_trofeos_plex({ persona: "nadie" }, ctx())).toEqual({ error: "nadie no tiene su cuenta de Plex vinculada." });
    expect((await h.consultar_trofeos_plex({ persona: "el fantasma" }, ctx())).error).toMatch(/^No identifico/);
});

test("¿quién ha terminado Breaking Bad?: los trofeos de esa serie (la serie primero) y quién los tiene, sin los ocultos", async () => {
    const r = await h.consultar_trofeos_plex({ titulo: "breaking bad" }, ctx());
    expect(r.trofeos[0]).toEqual({
        nombre: "Breaking Bad: completada",
        de_que_es: "Termina Breaking Bad entera (4 episodios)",
        dificultad: "Normal",
        quien_lo_tiene: ["Ana"],
    });
    expect(r.trofeos.find((t) => t.de_que_es === "Termina la temporada 1 de Breaking Bad").quien_lo_tiene).toEqual(["Ana", "Carlos"]);
    expect(await h.consultar_trofeos_plex({ titulo: "Los Soprano" }, ctx())).toMatchObject({ titulo: "Los Soprano", encontrado: false });
    // Una sola letra no busca nada.
    expect(plexTrofeos.buscar(G, "b")).toEqual([]);
});

test("sin nada: quién tiene más (sin los ocultos), con sus nombres", async () => {
    const r = await h.consultar_trofeos_plex({}, ctx());
    expect(r.mas_logros_de_plex.map((x) => x.persona)).toEqual(["Ana", "Carlos"]);
    expect(r.mas_logros_de_plex[0].logros).toBeGreaterThan(r.mas_logros_de_plex[1].logros);
    expect(await h.consultar_trofeos_plex({}, { ...ctx(), guildId: nuevoGuild("vacio") })).toEqual({
        error: "Nadie tiene la cuenta de Plex vinculada todavía.",
    });
    expect(await h.consultar_trofeos_plex({}, { userId: "x" })).toEqual({ error: "Solo disponible en servidores." });
});
