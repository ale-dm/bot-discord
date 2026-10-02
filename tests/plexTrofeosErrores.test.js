// 🍿 Trofeos de Plex cuando algo falla: Tautulli caído al sincronizar, fichas o trofeos que fallan (los logros de la
// fase 1 siguen), datos corruptos en la BD, formularios sin el campo opcional y menús que no son de aquí. Nada de eso
// debe romper el bot ni dejar promesas sin capturar.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getHistoryPage: jest.fn(async () => []),
    getLibraries: jest.fn(async () => []),
    getLibraryMediaInfo: jest.fn(async () => ({ filas: [], total: 0 })),
    getMetadata: jest.fn(async () => null),
    getChildrenMetadata: jest.fn(async () => []),
    getStreamData: jest.fn(async () => null),
}));
const tautulli = require("../src/services/tautulliClient");
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const plexFichas = require("../src/systems/plexFichas");
const plexTrofeos = require("../src/systems/plexTrofeos");
const plexHistorial = require("../src/systems/plexHistorial");
const achievements = require("../src/systems/achievementsSystem");
const { handlePlexButton, handlePlexModal, handlePlexStringSelect } = require("../src/adminPanel/plex");

let n = 0;
const nuevoGuild = () => `guild-errores-${++n}`;
const guildDe = (id) => ({ id, name: id, channels: { cache: new Map(), fetch: async () => null } });
const verPeli = (g, user, key) =>
    db
        .prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, visto)
             VALUES (?, ?, ?, 'movie', ?, ?, 2000, 1780000000, 7200, 1)`,
        )
        .run(g, ++n, String(user), key, `Peli ${key}`);
const sinPromesasSueltas = [];
process.on("unhandledRejection", (e) => sinPromesasSueltas.push(e));

afterEach(() => {
    jest.restoreAllMocks();
    expect(sinPromesasSueltas).toEqual([]);
});

describe("panel", () => {
    test("◀ Plex vuelve a la pantalla de Plex", async () => {
        const i = { customId: "paneladmin_plex_home", guildId: nuevoGuild(), update: jest.fn(async () => {}) };
        expect(await handlePlexButton(i)).toBe(true);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toBe("🎬 Plex / Tautulli");
    });

    test("📼 Sincronizar con Tautulli caído avisa del error", async () => {
        tautulli.getHistoryPage.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
        const g = nuevoGuild();
        const i = {
            customId: "paneladmin_plex_historial",
            guildId: g,
            guild: guildDe(g),
            user: { tag: "admin" },
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        expect(await handlePlexButton(i)).toBe(true);
        expect(i.editReply.mock.calls[0][0]).toEqual({ content: "❌ No se pudo sincronizar: connect ECONNREFUSED" });
    });

    test("el formulario sin el campo opcional (Discord no lo manda) crea el trofeo igual", async () => {
        const g = nuevoGuild();
        const campos = { nombre: "Cinéfilo extremo", condicion: "peliculas 500", recompensa: "5000" };
        const i = {
            customId: "paneladmin_plex_trofeo_modal",
            guildId: g,
            guild: guildDe(g),
            user: { id: "admin" },
            fields: {
                getTextInputValue: (k) => {
                    if (!(k in campos)) throw new Error(`Bad input: ${k}`);
                    return campos[k];
                },
            },
            reply: jest.fn(async () => {}),
        };
        expect(await handlePlexModal(i)).toBe(true);
        expect(plexTrofeos.resumen(g).admin[0]).toMatchObject({ nombre: "Cinéfilo extremo", descripcion: "Ve 500 películas distintas" });
    });

    test("si el cálculo del trofeo nuevo falla, solo se avisa en el log (la respuesta ya se dio)", async () => {
        jest.spyOn(plexHistorial, "actualizarLogros").mockRejectedValueOnce(new Error("disco lleno"));
        const g = nuevoGuild();
        const campos = { nombre: "X", condicion: "horas 1", recompensa: "1", descripcion: "" };
        const i = {
            customId: "paneladmin_plex_trofeo_modal",
            guildId: g,
            guild: guildDe(g),
            user: { id: "admin" },
            fields: { getTextInputValue: (k) => campos[k] },
            reply: jest.fn(async () => {}),
        };
        await handlePlexModal(i);
        await new Promise((r) => setTimeout(r, 20));
        expect(i.reply.mock.calls[0][0].content).toMatch(/^✅/);
    });

    test("un menú o un botón que no es de los trofeos no se toca", async () => {
        expect(await handlePlexStringSelect({ customId: "paneladmin_otra_cosa", values: ["x"] })).toBe(false);
        expect(await handlePlexButton({ customId: "paneladmin_plex_desconocido", guildId: nuevoGuild() })).toBe(false);
    });
});

describe("sincronización", () => {
    test("si los trofeos fallan, los logros de la fase 1 siguen", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g, 1, "a");
        jest.spyOn(plexTrofeos, "eventosDe").mockRejectedValueOnce(new Error("fallo raro"));
        const [r] = await plexHistorial.actualizarLogros(g);
        expect(r.desbloqueados.map((a) => a.id)).toContain("plex_pelis_1");
    });

    test("si las fichas fallan, se calcula igual con las que hay", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g, 1, "b");
        jest.spyOn(plexFichas, "actualizar").mockRejectedValueOnce(new Error("Tautulli raro"));
        const r = await plexHistorial.sincronizarYCalcular(guildDe(g));
        expect(r.fichas).toBeNull();
        expect(r.logros[0].desbloqueados.map((a) => a.id)).toContain("plex_pelis_1");
    });

    test("si la revisión de idiomas falla, se calcula igual con lo que hay", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g, 1, "e");
        jest.spyOn(require("../src/systems/plexIdiomas"), "actualizar").mockRejectedValueOnce(new Error("Tautulli raro"));
        const r = await plexHistorial.sincronizarYCalcular(guildDe(g));
        expect(r.idiomas).toBeNull();
        expect(r.logros[0].desbloqueados.map((a) => a.id)).toContain("plex_pelis_1");
    });

    test("el cron sigue con los demás servidores si uno falla", async () => {
        const g1 = nuevoGuild();
        const g2 = nuevoGuild();
        for (const g of [g1, g2]) plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g2, 1, "c");
        tautulli.getHistoryPage.mockRejectedValueOnce(new Error("timeout"));
        const client = { guilds: { cache: new Map([g1, g2].map((g) => [g, guildDe(g)])) } };
        await expect(plexHistorial.sincronizarTodos(client)).resolves.toBeUndefined();
        expect(achievements.listUserAchievements(g2, "disc-1").find((a) => a.id === "plex_pelis_1").completed).toBe(true);
    });

    test("si la comprobación de Plex falla por red, no se pide ni se marca nada", async () => {
        const g = nuevoGuild();
        db.prepare("INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, actualizada) VALUES (?, 'conocida', 'movie', 'C', ?)").run(
            g,
            Date.now(),
        );
        db.prepare("INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, actualizada) VALUES (?, 'nueva', 'movie', 'N', 0)").run(g);
        db.prepare("INSERT INTO plex_sync (guildId, ultimo_inicio, biblioteca_revisada) VALUES (?, 0, ?)").run(g, Date.now());
        tautulli.getMetadata.mockRejectedValueOnce(new Error("ETIMEDOUT"));
        const r = await plexFichas.actualizar(g);
        expect(r).toMatchObject({ fichas: 0, errores: 1, llamadas: 1, pendientes: 1 });
    });
});

describe("datos corruptos en la BD", () => {
    test("una ficha con el JSON roto se lee como vacía", () => {
        const g = nuevoGuild();
        db.prepare(
            "INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, generos, directores, colecciones, temporadas, actualizada) VALUES (?, 'x', 'show', 'X', '{roto', 'nope', '[', '{', 1)",
        ).run(g);
        const [s] = plexFichas.cargar(g).series;
        expect(s).toMatchObject({ generos: [], directores: [], colecciones: [], temporadas: null });
    });

    test("un trofeo de admin con la condición estropeada se ignora sin romper nada", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g, 1, "d");
        db.prepare(
            "INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, condicion, creado) VALUES (?, 'admin:roto', 'admin', 'Roto', 'x', '???', 1)",
        ).run(g);
        const [r] = await plexHistorial.actualizarLogros(g);
        expect(r.desbloqueados.map((a) => a.id)).toContain("plex_pelis_1");
        expect(achievements.listUserAchievements(g, "disc-1").find((a) => a.id === "plext:admin:roto")).toMatchObject({
            progress: 0,
            completed: false,
        });
    });

    test("si no se puede leer el catálogo de trofeos, los logros fijos siguen", () => {
        jest.spyOn(plexTrofeos, "catalogo").mockImplementation(() => {
            throw new Error("no such table");
        });
        expect(achievements.getCatalog(nuevoGuild()).length).toBe(achievements.CATALOG.length);
    });
});
