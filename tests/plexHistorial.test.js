// 🍿 Logros de Plex, fase 1: copia del historial de Tautulli en la BD, estadísticas de cada uno (en hora de Madrid) y
// logros genéricos (horas, películas, episodios, series, maratón, atracón, noctámbulo).
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getHistoryPage: jest.fn(),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
}));
const tautulli = require("../src/services/tautulliClient");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const { buildPlexHome, handlePlexButton } = require("../src/adminPanel/plex");

const G = "guild-plex";
// Unix (s) de una hora de Madrid en julio de 2026 (UTC+2).
const madrid = (dia, hora, min = 0) => Date.UTC(2026, 6, dia, hora - 2, min) / 1000;
let siguienteId = 1;
const episodio = (user, serie, n, inicio, segundos = 2700, extra = {}) => ({
    row_id: siguienteId++,
    user_id: user,
    media_type: "episode",
    rating_key: `${serie}-${n}`,
    grandparent_rating_key: serie,
    title: `Episodio ${n}`,
    grandparent_title: `Serie ${serie}`,
    parent_media_index: 1,
    media_index: n,
    started: inicio,
    play_duration: segundos,
    percent_complete: 100,
    watched_status: 1,
    ...extra,
});
const pelicula = (user, key, inicio, segundos = 7200, extra = {}) => ({
    row_id: siguienteId++,
    user_id: user,
    media_type: "movie",
    rating_key: key,
    title: `Película ${key}`,
    started: inicio,
    play_duration: segundos,
    percent_complete: 100,
    watched_status: 1,
    ...extra,
});
// Tautulli devuelve el historial en páginas: aquí, todo en una (o lo que se pase por página).
const historial = (...paginas) =>
    tautulli.getHistoryPage.mockImplementation(async (_g, { start }) => paginas[start / plexHistorial.PAGINA] || []);

describe("copia del historial", () => {
    const G2 = "guild-paginas";

    test("la primera vez pagina el historial entero, ignora lo que no es vídeo y no repite", async () => {
        const pagina1 = Array.from({ length: plexHistorial.PAGINA }, (_, n) => episodio(1, "larga", n, madrid(1, 20) + n));
        const pagina2 = [
            pelicula(1, "p", madrid(2, 20)),
            pelicula(2, "q", madrid(3, 20)),
            { row_id: siguienteId++, user_id: 1, media_type: "track", started: madrid(3, 21) },
            // Las versiones antiguas de Tautulli llaman "id" a lo que ahora es "row_id".
            { ...pelicula(2, "antigua", madrid(1, 10)), row_id: undefined, id: 999999 },
        ];
        historial(pagina1, pagina2);
        tautulli.getHistoryPage.mockClear();

        const r = await plexHistorial.sincronizar(G2);
        expect(r).toEqual({ nuevas: plexHistorial.PAGINA + 3, leidas: plexHistorial.PAGINA + 4, primera: true });
        expect(tautulli.getHistoryPage.mock.calls.map(([, o]) => [o.start, o.after])).toEqual([
            [0, null],
            [plexHistorial.PAGINA, null],
        ]);

        // La siguiente vez pide desde dos días antes de la última y lo que ya estaba no cuenta.
        historial([...pagina2, pelicula(2, "nueva", madrid(4, 22))]);
        tautulli.getHistoryPage.mockClear();
        const r2 = await plexHistorial.sincronizar(G2);
        expect(r2).toMatchObject({ nuevas: 1, primera: false });
        expect(tautulli.getHistoryPage.mock.calls[0][1].after).toBe("2026-07-01");
        expect(plexHistorial.estado(G2).reproducciones).toBe(plexHistorial.PAGINA + 4);
    });
});

describe("estadísticas y logros", () => {
    const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
    const guild = { id: G, name: G, channels: { cache: new Map([["canal-logros", canal]]), fetch: async () => null } };
    const dms = [];
    const client = {
        guilds: { cache: new Map([[G, guild]]) },
        users: { fetch: async (id) => ({ send: async (texto) => dms.push({ id, texto }) }) },
    };

    beforeAll(async () => {
        historial([
            // Día 10: 5 episodios de la misma serie desde las 18:00 y una película a las 23:30.
            ...[1, 2, 3, 4, 5].map((n) => episodio(8, "s1", n, madrid(10, 18) + n * 2700)),
            pelicula(8, "m1", madrid(10, 23, 30)),
            // Día 11 a las 00:30: otro día.
            pelicula(8, "m2", madrid(11, 0, 30)),
            // Repetir un episodio no suma episodios (sí horas); una película a medias tampoco cuenta como vista.
            episodio(8, "s1", 1, madrid(12, 20)),
            pelicula(8, "m3", madrid(12, 22), 1800, { watched_status: 0, percent_complete: 25 }),
            // De madrugada: a las 3:30 media hora cuenta; a las 4:00 cinco minutos, no.
            episodio(8, "s2", 1, madrid(13, 3, 30), 1800),
            episodio(8, "s2", 2, madrid(14, 4), 300, { watched_status: 0 }),
            // Alguien sin vincular: se guarda, pero no tiene logros.
            pelicula(9, "m1", madrid(10, 21)),
        ]);
        await plexHistorial.sincronizar(G);
        plexLinks.setLink(G, "disc-8", "8", "ana");
        guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
    });

    test("horas, películas, episodios y series, y por días en hora de Madrid", () => {
        expect(plexHistorial.estadisticas(G, "8")).toEqual({
            horas: 9, // 34.500 s
            peliculas: 2,
            episodios: 6,
            series: 2,
            maratonHoras: 5, // día 10: 5 × 45 min + 2 h
            atracon: 5,
            noches: 1,
        });
        expect(plexHistorial.momento(madrid(11, 0, 30))).toEqual({ dia: "2026-07-11", hora: 0 });
    });

    test("la primera vez no se anuncia cada logro: llega un DM con el resumen", async () => {
        const [r] = await plexHistorial.actualizarLogros(guild, client);
        expect(r.primeraVez).toBe(true);
        expect(r.desbloqueados.map((a) => a.id).sort()).toEqual(["plex_atracon_5", "plex_pelis_1"]);
        expect(canal.send).not.toHaveBeenCalled();
        expect(dms).toEqual([{ id: "disc-8", texto: expect.stringMatching(/historial de Plex.*\*\*2\*\* logros: .*Se apagan las luces/) }]);
        const horas = achievements.listUserAchievements(G, "disc-8").find((a) => a.id === "plex_horas_10");
        expect(horas).toMatchObject({ progress: 9, completed: false });
    });

    test("después, lo nuevo se anuncia en el canal de logros como cualquier otro logro", async () => {
        historial([pelicula(8, "m4", madrid(20, 21))]);
        await plexHistorial.sincronizarTodos(client);
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(canal.send.mock.calls[0][0]).toMatch(/<@disc-8> desbloqueó logros:\n🏅 \*\*Palomitas en mano\*\*/);
        expect(dms).toHaveLength(1);
        // Y se pueden reclamar como los demás.
        expect(achievements.claimAchievement(G, "disc-8", "plex_horas_10").ok).toBe(true);
    });

    test("con la categoría plex desactivada no cuenta nada", async () => {
        guildSettings.setSetting(G, "logros.disabled_categories", "plex");
        plexLinks.setLink(G, "disc-9", "9", "luis");
        const r = await plexHistorial.actualizarLogros(guild, client);
        expect(r.find((x) => x.discordUserId === "disc-9").desbloqueados).toEqual([]);
        guildSettings.setSetting(G, "logros.disabled_categories", "");
        plexLinks.removeLink(G, "disc-9");
    });

    test("/paneladmin → Plex enseña el historial y lo sincroniza con un botón", async () => {
        expect(buildPlexHome(G).embeds[0].data.description).toMatch(
            /📼 Historial para los logros: \*\*1[0-9]\*\* reproducciones · sincronizado <t:/,
        );
        historial([]);
        const i = {
            customId: "paneladmin_plex_historial",
            guildId: G,
            guild,
            client,
            user: { tag: "admin" },
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        expect(await handlePlexButton(i)).toBe(true);
        expect(i.editReply.mock.calls[0][0].content).toMatch(
            /Historial sincronizado: \*\*0\*\* reproducciones nuevas · \*\*1[0-9]\*\* guardadas/,
        );
    });
});

test("hay 17 logros de Plex en el catálogo, todos con su evento", () => {
    const plex = achievements.CATALOG.filter((a) => a.category === "plex");
    expect(plex).toHaveLength(17);
    expect(new Set(plex.map((a) => a.event))).toEqual(new Set(Object.values(plexHistorial.EVENTOS)));
});
