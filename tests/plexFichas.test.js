// 🍿 Fichas de Plex (systems/plexFichas): repaso de la biblioteca de películas (páginas, bibliotecas vacías, películas
// que se van y vuelven), fichas de series (sin especiales), orden y presupuesto de llamadas, refrescos, fallos de red y
// Plex caído.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getLibraries: jest.fn(),
    getLibraryMediaInfo: jest.fn(),
    getMetadata: jest.fn(),
    getChildrenMetadata: jest.fn(),
}));
const tautulli = require("../src/services/tautulliClient");
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexFichas = require("../src/systems/plexFichas");

const DIA = 86400 * 1000;
let n = 0;
const nuevoGuild = () => `guild-fichas-${++n}`;
const peliculas = (cuantas, prefijo = "p") =>
    Array.from({ length: cuantas }, (_, i) => ({ rating_key: `${prefijo}${i}`, title: `Peli ${prefijo}${i}`, year: 2000 + (i % 20) }));
const meta = (key) => ({
    rating_key: key,
    title: `Peli ${key}`,
    year: 2001,
    section_id: 1,
    library_name: "Películas",
    genres: ["Drama"],
    directors: ["Alguien"],
    collections: [],
});
const fila = (g, key) => db.prepare("SELECT * FROM plex_fichas WHERE guildId = ? AND rating_key = ?").get(g, key);
const reproduccion = (g, extra) =>
    db
        .prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, porcentaje, visto)
             VALUES (@guildId, @id, '1', @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio, 100, 100, 1)`,
        )
        .run({
            guildId: g,
            id: ++n * 1000,
            tipo: "movie",
            rating_key: null,
            serie_key: null,
            titulo: null,
            serie: null,
            temporada: null,
            episodio: null,
            anio: null,
            inicio: Math.floor(Date.now() / 1000),
            ...extra,
        });

function biblioteca(lista, { items = lista.length, section = 1 } = {}) {
    tautulli.getLibraries.mockResolvedValue([
        { section_id: section, section_name: "Películas", section_type: "movie", count: items },
        { section_id: 9, section_name: "Series", section_type: "show", count: 3 },
    ]);
    tautulli.getLibraryMediaInfo.mockImplementation(async (_g, _s, { start, length }) => ({
        filas: lista.slice(start, start + length),
        total: lista.length,
    }));
}

beforeEach(() => {
    jest.resetAllMocks();
    tautulli.getConfig.mockReturnValue({ url: "http://tautulli.local", apiKey: "clave" });
    biblioteca([]);
    tautulli.getMetadata.mockImplementation(async (_g, key) => meta(key));
    tautulli.getChildrenMetadata.mockResolvedValue([]);
});

describe("biblioteca de películas", () => {
    test("pagina de 2.000 en 2.000 y apunta todas, solo de las bibliotecas de películas", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(4100));
        const r = await plexFichas.actualizar(g, { presupuesto: 0 });
        expect(r.nuevasEnBiblioteca).toBe(4100);
        expect(tautulli.getLibraryMediaInfo.mock.calls.map(([, s, o]) => [s, o.start, o.length])).toEqual([
            ["1", 0, 2000],
            ["1", 2000, 2000],
            ["1", 4000, 2000],
        ]);
        expect(plexFichas.estado(g)).toMatchObject({ peliculas: 4100, pendientes: 4100, peliculasPendientes: 4100, completa: false });
    });

    test("si Tautulli no pagina (devuelve siempre lo mismo), no se queda en bucle", async () => {
        const g = nuevoGuild();
        const todas = peliculas(2000);
        biblioteca(todas);
        tautulli.getLibraryMediaInfo.mockImplementation(async () => ({ filas: todas, total: 2000 }));
        await plexFichas.actualizar(g, { presupuesto: 0 });
        expect(tautulli.getLibraryMediaInfo).toHaveBeenCalledTimes(2);
        expect(plexFichas.estado(g).peliculas).toBe(2000);
    });

    test("una película que sale de Plex deja de contar; si vuelve, se vuelve a pedir su ficha", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(3));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(plexFichas.estado(g)).toMatchObject({ peliculas: 3, pendientes: 0, completa: true });

        biblioteca(peliculas(3).slice(1));
        db.prepare("UPDATE plex_sync SET biblioteca_revisada = 1 WHERE guildId = ?").run(g);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(fila(g, "p0").encontrada).toBe(0);
        expect(plexFichas.estado(g)).toMatchObject({ peliculas: 2, perdidas: 1 });

        biblioteca(peliculas(3));
        db.prepare("UPDATE plex_sync SET biblioteca_revisada = 1 WHERE guildId = ?").run(g);
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(fila(g, "p0")).toMatchObject({ encontrada: 1 });
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toContain("p0");
        expect(plexFichas.estado(g)).toMatchObject({ peliculas: 3, perdidas: 0, completa: true });
    });

    test("una lista vacía de una biblioteca que tiene películas no las da por borradas", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(5));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        biblioteca([], { items: 5 });
        db.prepare("UPDATE plex_sync SET biblioteca_revisada = 1 WHERE guildId = ?").run(g);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(plexFichas.estado(g)).toMatchObject({ peliculas: 5, perdidas: 0 });
    });

    test("la biblioteca se repasa cada 6 horas, no en cada sincronización", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(2));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        tautulli.getLibraries.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getLibraries).not.toHaveBeenCalled();
        db.prepare("UPDATE plex_sync SET biblioteca_revisada = ? WHERE guildId = ?").run(Date.now() - 7 * 3600 * 1000, g);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getLibraries).toHaveBeenCalledTimes(1);
    });

    test("si falla el repaso de la biblioteca, sigue con las fichas y lo vuelve a intentar la próxima vez", async () => {
        const g = nuevoGuild();
        reproduccion(g, { tipo: "episode", serie_key: "s1", serie: "Serie", temporada: 1, episodio: 1 });
        tautulli.getLibraries.mockRejectedValue(new Error("timeout"));
        const r = await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(r).toMatchObject({ errores: 1, fichas: 1 });
        expect(plexFichas.estado(g).bibliotecaRevisada).toBeNull();
        expect(plexFichas.estado(g).completa).toBe(false);
    });
});

describe("fichas", () => {
    test("de una película: géneros, directores, colecciones y biblioteca (sin repetir etiquetas)", async () => {
        const g = nuevoGuild();
        biblioteca([{ rating_key: 7, title: "Siete", year: 1995 }]);
        tautulli.getMetadata.mockResolvedValue({
            rating_key: "7",
            title: "Se7en",
            year: "1995",
            section_id: 1,
            library_name: "Películas",
            genres: ["Crimen", "Suspense", "Crimen"],
            directors: [{ tag: "David Fincher" }],
            collections: [],
        });
        await plexFichas.actualizar(g, { presupuesto: 100 });
        const [p] = plexFichas.cargar(g).peliculas;
        expect(p).toMatchObject({
            rating_key: "7",
            titulo: "Se7en",
            anio: 1995,
            section_id: "1",
            generos: ["Crimen", "Suspense"],
            directores: ["David Fincher"],
            colecciones: [],
        });
    });

    test("de una serie: temporadas con sus episodios, sin especiales, temporadas vacías ni episodios 0", async () => {
        const g = nuevoGuild();
        reproduccion(g, { tipo: "episode", serie_key: "show", serie: "La serie", temporada: 1, episodio: 1 });
        tautulli.getMetadata.mockResolvedValue({
            rating_key: "show",
            title: "La serie",
            year: 2020,
            section_id: 9,
            library_name: "Series",
            genres: ["Anime"],
        });
        const hijos = {
            "show|show": [
                { rating_key: "t0", media_index: 0 },
                { rating_key: "t1", media_index: "1" },
                { rating_key: "t2", media_index: 2 },
                { rating_key: "t3", media_index: 3 },
            ],
            "t1|season": [{ media_index: "2" }, { media_index: 1 }, { media_index: 1 }, { media_index: 0 }],
            "t2|season": [{ media_index: 1 }],
            "t3|season": [],
        };
        tautulli.getChildrenMetadata.mockImplementation(async (_g, k, t) => hijos[`${k}|${t}`] || []);
        const r = await plexFichas.actualizar(g, { presupuesto: 100 });
        // Repaso de la biblioteca (2) + ficha + lista de temporadas + 3 temporadas (la 0 no se pide).
        expect(r).toMatchObject({ fichas: 1, llamadas: 2 + 5 });
        expect(tautulli.getChildrenMetadata.mock.calls.map(([, k]) => k)).not.toContain("t0");
        const [s] = plexFichas.cargar(g).series;
        expect(s).toMatchObject({ titulo: "La serie", generos: ["Anime"], temporadas: { 1: [1, 2], 2: [1] } });
    });

    test("primero las series vistas, luego las películas vistas y después las demás; sin pasarse del presupuesto", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(6));
        reproduccion(g, { rating_key: "otra-clave", titulo: "Peli p4", anio: 2004 }); // vista con otra clave: por título y año
        reproduccion(g, { tipo: "episode", serie_key: "s1", serie: "S", temporada: 1, episodio: 1 });
        tautulli.getMetadata.mockImplementation(async (_g, key) => (key === "s1" ? { rating_key: "s1", title: "S" } : meta(key)));
        // Repaso de la biblioteca (2 llamadas) y quedan 2: empiezan la serie y la película vista, y nada más (las fichas
        // que ya están en marcha terminan aunque se pasen un poco).
        const r = await plexFichas.actualizar(g, { presupuesto: 4 });
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toEqual(["s1", "p4"]);
        expect(r.llamadas).toBeLessThanOrEqual(4 + 2);
        expect(plexFichas.estado(g).pendientes).toBe(5);
        // La siguiente vez: la comprobación de Plex (con p4, ya conocida) y las demás.
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toEqual(["p4", "p0", "p1", "p2", "p3", "p5"]);
        expect(plexFichas.estado(g)).toMatchObject({ pendientes: 0, completa: true });
    });

    test("una serie que ya no está se marca y se vuelve a probar a la semana", async () => {
        const g = nuevoGuild();
        reproduccion(g, { tipo: "episode", serie_key: "borrada", serie: "Borrada", temporada: 1, episodio: 1 });
        tautulli.getMetadata.mockResolvedValue(null);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(fila(g, "borrada")).toMatchObject({ encontrada: 0 });
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata).not.toHaveBeenCalled();
        db.prepare("UPDATE plex_fichas SET actualizada = ? WHERE guildId = ?").run(Date.now() - 8 * DIA, g);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toEqual(["borrada"]);
    });

    test("las series vistas en el último mes se vuelven a mirar a los 3 días (episodios nuevos); las otras no", async () => {
        const g = nuevoGuild();
        const ahora = Math.floor(Date.now() / 1000);
        reproduccion(g, { tipo: "episode", serie_key: "reciente", serie: "Reciente", temporada: 1, episodio: 1, inicio: ahora - 3600 });
        reproduccion(g, { tipo: "episode", serie_key: "antigua", serie: "Antigua", temporada: 1, episodio: 1, inicio: ahora - 60 * 86400 });
        tautulli.getMetadata.mockImplementation(async (_g, k) => ({ rating_key: k, title: k }));
        tautulli.getChildrenMetadata.mockImplementation(async (_g, k, t) =>
            t === "show" ? [{ rating_key: `${k}-1`, media_index: 1 }] : [{ media_index: 1 }],
        );
        await plexFichas.actualizar(g, { presupuesto: 100 });
        db.prepare("UPDATE plex_fichas SET actualizada = ? WHERE guildId = ?").run(Date.now() - 4 * DIA, g);
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toEqual(["reciente"]);
    });

    test("una serie de la que Tautulli no dio temporadas se vuelve a mirar al día siguiente", async () => {
        const g = nuevoGuild();
        reproduccion(g, { tipo: "episode", serie_key: "rara", serie: "Rara", temporada: 1, episodio: 1, inicio: 1000 });
        tautulli.getMetadata.mockResolvedValue({ rating_key: "rara", title: "Rara" });
        tautulli.getChildrenMetadata.mockResolvedValue([]);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(fila(g, "rara").temporadas).toBe("{}");
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata).not.toHaveBeenCalled();
        db.prepare("UPDATE plex_fichas SET actualizada = ? WHERE guildId = ?").run(Date.now() - 2 * DIA, g);
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(tautulli.getMetadata).toHaveBeenCalledTimes(1);
    });

    test("las películas se refrescan al mes", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(2));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        db.prepare("UPDATE plex_fichas SET actualizada = ? WHERE guildId = ? AND rating_key = 'p1'").run(Date.now() - 31 * DIA, g);
        tautulli.getMetadata.mockClear();
        await plexFichas.actualizar(g, { presupuesto: 100 });
        // La primera es la comprobación de Plex (la más reciente); después, la vieja.
        expect(tautulli.getMetadata.mock.calls.map(([, k]) => k)).toEqual(["p0", "p1"]);
    });
});

describe("fallos", () => {
    test("con 5 fallos de red seguidos para y deja lo demás pendiente", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(30));
        tautulli.getMetadata.mockRejectedValue(new Error("ECONNRESET"));
        const r = await plexFichas.actualizar(g, { presupuesto: 1000 });
        expect(r.errores).toBeGreaterThanOrEqual(5);
        expect(r.errores).toBeLessThan(5 + 4); // los 4 trabajadores en paralelo pueden tener una en marcha
        expect(plexFichas.estado(g).pendientes).toBe(30);
    });

    test("un fallo de red al pedir una temporada deja la serie pendiente (no se guarda a medias)", async () => {
        const g = nuevoGuild();
        reproduccion(g, { tipo: "episode", serie_key: "s", serie: "S", temporada: 1, episodio: 1 });
        tautulli.getMetadata.mockResolvedValue({ rating_key: "s", title: "S" });
        tautulli.getChildrenMetadata.mockImplementation(async (_g, k, t) => {
            if (t === "show")
                return [
                    { rating_key: "s1", media_index: 1 },
                    { rating_key: "s2", media_index: 2 },
                ];
            if (k === "s2") throw new Error("timeout");
            return [{ media_index: 1 }];
        });
        const r = await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(r).toMatchObject({ fichas: 0, errores: 1 });
        expect(fila(g, "s")).toMatchObject({ actualizada: 0, temporadas: null });
    });

    test("si Plex no da la ficha de una película que sí está, no marca nada como perdido", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(2));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        reproduccion(g, { tipo: "episode", serie_key: "s", serie: "S", temporada: 1, episodio: 1 });
        tautulli.getMetadata.mockResolvedValue(null); // Plex caído: Tautulli no encuentra nada
        const r = await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(r).toMatchObject({ fichas: 0, errores: 1, llamadas: 1 });
        expect(fila(g, "s")).toMatchObject({ encontrada: 1, actualizada: 0 });
    });
});

describe("anime y bibliotecas", () => {
    test("las bibliotecas elegidas (con espacios) mandan sobre el nombre y el género", () => {
        const g = nuevoGuild();
        guildSettings.setSetting(g, "plex.bibliotecas_anime", " 3 , 4 ");
        const cfg = plexFichas.configAnime(g);
        expect(cfg).toEqual({ ids: new Set(["3", "4"]), auto: false });
        expect(plexFichas.esAnime({ section_id: 4, biblioteca: "Pelis", generos: [] }, cfg)).toBe(true);
        expect(plexFichas.esAnime({ section_id: "1", biblioteca: "Anime", generos: ["Anime"] }, cfg)).toBe(false);
    });

    test("automático: 'anime' en el nombre de la biblioteca (sin mayúsculas) o el género Anime (con tildes o no)", () => {
        const cfg = plexFichas.configAnime(nuevoGuild());
        expect(plexFichas.esAnime({ biblioteca: "ANIME 4K", generos: [] }, cfg)).toBe(true);
        expect(plexFichas.esAnime({ biblioteca: "Series", generos: ["ánime"] }, cfg)).toBe(true);
        expect(plexFichas.esAnime({ biblioteca: "Series", generos: ["Animación"] }, cfg)).toBe(false);
        expect(plexFichas.esAnime({ biblioteca: null, generos: [] }, cfg)).toBe(false);
    });

    test("nombres de las bibliotecas sacados de las fichas, y bibliotecas de Tautulli", async () => {
        const g = nuevoGuild();
        biblioteca(peliculas(1));
        await plexFichas.actualizar(g, { presupuesto: 100 });
        expect(plexFichas.nombresBibliotecas(g)).toEqual(new Map([["1", "Películas"]]));
        expect(await plexFichas.bibliotecas(g)).toEqual([
            { id: "1", nombre: "Películas", tipo: "movie", items: 1 },
            { id: "9", nombre: "Series", tipo: "show", items: 3 },
        ]);
    });

    test("clave de película: mismo título con o sin tildes y mayúsculas, distinto año, distinta película", () => {
        expect(plexFichas.clavePelicula("El Laberinto del Fauno", 2006)).toBe(plexFichas.clavePelicula("el  laberinto del fauno", "2006"));
        expect(plexFichas.clavePelicula("Ánimo", 2000)).toBe(plexFichas.clavePelicula("animo", 2000));
        expect(plexFichas.clavePelicula("Dune", 1984)).not.toBe(plexFichas.clavePelicula("Dune", 2021));
    });
});
