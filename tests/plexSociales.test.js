// 🍿 Trofeos sociales de Plex (F-PX-12): "Cine compartido" (la misma película que otro vinculado el mismo día), "Sin
// spoilers" (verlo en las 24 h desde que llega a Plex) y "Primero del servidor" (el primero en ver un estreno, en su
// primera semana en Plex). Cuándo llega cada cosa sale de las fichas de Tautulli (added_at), que ahora se guarda.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getLibraries: jest.fn(async () => [{ section_id: "1", section_name: "Películas", section_type: "movie", count: "1" }]),
    getLibraryMediaInfo: jest.fn(async () => ({ filas: [{ rating_key: "m1", title: "Nueva", year: "2026" }], total: 1 })),
    getMetadata: jest.fn(),
    getChildrenMetadata: jest.fn(),
    getStreamData: jest.fn(async () => null),
}));
const tautulli = require("../src/services/tautulliClient");
const { db, nuevoGuild, madrid, peli, serie, ver, verPeli, verEps, vincular } = require("./ayudaPlex");
const guildSettings = require("../src/systems/guildSettings");
const achievements = require("../src/systems/achievementsSystem");
const plexFichas = require("../src/systems/plexFichas");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");

const H = 3600;
const sociales = (g) =>
    Object.fromEntries(plexTrofeos.sociales(g, require("../src/systems/plexLinks").getLinks(g), plexTrofeos.contexto(g)));

describe("las fichas guardan cuándo llegó cada cosa a Plex", () => {
    test("películas (get_metadata) y cada episodio (get_children_metadata), con los números como texto", async () => {
        const g = nuevoGuild("guild-social");
        tautulli.getMetadata.mockImplementation(async (_g, key) =>
            key === "m1"
                ? { rating_key: "m1", title: "Nueva", year: "2026", section_id: "1", library_name: "Películas", added_at: "1780000000" }
                : key === "s"
                  ? { rating_key: "s", title: "Serie", section_id: "2", library_name: "Series" }
                  : null,
        );
        tautulli.getChildrenMetadata.mockImplementation(
            async (_g, key, tipo) =>
                ({
                    "s|show": [
                        { rating_key: "s0", media_index: "0" },
                        { rating_key: "s1", media_index: "1" },
                    ],
                    "s0|season": [{ media_index: "1", added_at: "1700000000" }],
                    "s1|season": [
                        { media_index: "1", added_at: "1780000100" },
                        { media_index: "2", added_at: "" },
                    ],
                })[`${key}|${tipo}`] || [],
        );
        ver(g, 1, { tipo: "episode", serie_key: "s", serie: "Serie", temporada: 1, episodio: 1 });
        await plexFichas.actualizar(g, { presupuesto: 100 });
        const { peliculas, series } = plexFichas.cargar(g);
        expect(peliculas.find((p) => p.rating_key === "m1").alta).toBe(1780000000);
        // Sin los especiales (temporada 0) y sin los que no lo dicen.
        expect(series.find((s) => s.rating_key === "s").altas).toEqual({ "1:1": 1780000100 });
    });

    test("una ficha de antes (sin la fecha) se lee igual", () => {
        const g = nuevoGuild("guild-social");
        serie(g, "vieja", "Vieja", { 1: [1] });
        db.prepare("UPDATE plex_fichas SET altas = NULL WHERE guildId = ?").run(g);
        expect(plexFichas.cargar(g).series[0].altas).toEqual({});
    });
});

describe("las cuentas sociales", () => {
    const g = nuevoGuild("guild-social");
    const T = madrid("2026-06-10", 12); // cuando llegan a Plex el episodio y la película nuevos
    beforeAll(() => {
        vincular(g, 1, 2);
        // Cine compartido: Origen el mismo día (una de las dos copias en la biblioteca 4K, con otra clave).
        peli(g, "origen", "Origen", 2010);
        peli(g, "origen-4k", "Origen", 2010, { section_id: "9", biblioteca: "4K" });
        verPeli(g, 1, "origen", "Origen", 2010, { inicio: madrid("2026-06-01", 10) });
        verPeli(g, 2, "origen-4k", "Origen", 2010, { inicio: madrid("2026-06-01", 23, 30) });
        // Memento: uno a las 23:30 y otro a las 00:30 del día siguiente (en Madrid): no es el mismo día.
        peli(g, "memento", "Memento", 2000);
        verPeli(g, 1, "memento", "Memento", 2000, { inicio: madrid("2026-06-02", 23, 30) });
        verPeli(g, 2, "memento", "Memento", 2000, { inicio: madrid("2026-06-03", 0, 30) });
        // Tenet: con alguien sin vincular (el 9) no cuenta.
        peli(g, "tenet", "Tenet", 2020);
        verPeli(g, 1, "tenet", "Tenet", 2020, { inicio: madrid("2026-06-04") });
        verPeli(g, 9, "tenet", "Tenet", 2020, { inicio: madrid("2026-06-04") });

        // Estrenos. El episodio 1x1 llega en T: Ana (1) lo ve a las 3 h y Luis (2) a las 30 h; el 9 (sin vincular), antes.
        serie(g, "s", "Serie", { 1: [1, 2, 3] }, { altas: { "1:1": T, "1:2": T, "1:3": T - 10 * 24 * H } });
        verEps(g, 9, "s", "Serie", [[1, 1]], { inicio: T + 2 * H });
        verEps(g, 1, "s", "Serie", [[1, 1]], { inicio: T + 3 * H });
        verEps(g, 2, "s", "Serie", [[1, 1]], { inicio: T + 30 * H });
        // 1x2: Luis el primero (a la hora); Ana después, en el día.
        verEps(g, 2, "s", "Serie", [[1, 2]], { inicio: T + H });
        verEps(g, 1, "s", "Serie", [[1, 2]], { inicio: T + 5 * H });
        // 1x3 llegó hace 10 días: ya no es estreno.
        verEps(g, 1, "s", "Serie", [[1, 3]], { inicio: T });
        // La película nueva: Luis la ve en el día; antes de que llegara no cuenta (una reproducción rara de prueba).
        peli(g, "nueva", "Nueva", 2026, { alta: T });
        verPeli(g, 1, "nueva", "Nueva", 2026, { inicio: T - 13 * H }); // el día anterior a las 23:00
        verPeli(g, 2, "nueva", "Nueva", 2026, { inicio: T + 2 * H });
        // Una serie sin fechas (ficha de antes): no cuenta para nada de estrenos.
        serie(g, "vieja", "Vieja", { 1: [1] });
        verEps(g, 1, "vieja", "Vieja", [[1, 1]], { inicio: T });
    });

    test("Cine compartido: la misma película (aunque sea otra copia) el mismo día en Madrid, entre vinculados", () => {
        const s = sociales(g);
        expect(s["disc-1"].compartidas).toBe(1);
        expect(s["disc-2"].compartidas).toBe(1);
    });

    test("Sin spoilers: en las 24 h desde que llega (ni antes, ni a las 30 h, ni lo que llegó hace días)", () => {
        const s = sociales(g);
        expect(s["disc-1"].sinSpoilers).toBe(2); // 1x1 y 1x2
        expect(s["disc-2"].sinSpoilers).toBe(2); // 1x2 y la película nueva
    });

    test("Primero del servidor: el primero en verlo en su primera semana, aunque sea alguien sin vincular", () => {
        const s = sociales(g);
        expect(s["disc-1"].primero).toBe(0); // en 1x1 se le adelantó el 9; en 1x2, Luis
        expect(s["disc-2"].primero).toBe(2); // 1x2 y la película nueva (lo de Ana antes de que llegara no cuenta)
    });

    test("salen como logros de Plex, con su anuncio", async () => {
        guildSettings.setSetting(g, "logros.notify_channel_id", "canal");
        const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
        const guild = { id: g, name: g, channels: { cache: new Map([["canal", canal]]), fetch: async () => null } };
        const r = await plexHistorial.actualizarLogros(guild);
        const ids = (u) => r.find((x) => x.discordUserId === u).desbloqueados.map((a) => a.id);
        expect(ids("disc-1")).toEqual(expect.arrayContaining(["plex_compartido_1", "plex_spoilers_1"]));
        expect(ids("disc-1")).not.toContain("plex_primero_1");
        expect(ids("disc-2")).toEqual(expect.arrayContaining(["plex_compartido_1", "plex_spoilers_1", "plex_primero_1"]));
        const anuncioLuis = canal.send.mock.calls.map(([m]) => m.content).find((c) => c.includes("<@disc-2>"));
        expect(anuncioLuis).toMatch(/🏅 \*\*Primero del servidor\*\* — 🟢 Fácil/);
        const luis = achievements.listUserAchievements(g, "disc-2").find((a) => a.id === "plex_primero_25");
        expect(luis).toMatchObject({ progress: 2, target: 25, completed: false });
    });

    test("sin nadie vinculado, nada", () => {
        expect(plexTrofeos.sociales(g, [], plexTrofeos.contexto(g)).size).toBe(0);
    });
});
