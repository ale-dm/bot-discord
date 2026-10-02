// 🍿 Trofeos de Plex: casos límite de cada regla, con las fichas puestas directamente en la BD. Series vueltas a
// añadir, películas en dos bibliotecas, géneros en dos idiomas, mínimos y máximos de directores y sagas, biblioteca
// incompleta, décadas, anime, cada condición de los trofeos de admin, Gemini (fallos, lotes, máximo) y la categoría
// desactivada.
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(),
}));
const gemini = require("../src/services/geminiClient");
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");

let n = 0;
let filaId = 1;
const nuevoGuild = () => `guild-casos-${++n}`;

function ficha(g, f) {
    db.prepare(
        `INSERT OR REPLACE INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, temporadas, encontrada, actualizada)
         VALUES (@g, @rating_key, @tipo, @titulo, @anio, @section_id, @biblioteca, @generos, @directores, @colecciones, @temporadas, @encontrada, @actualizada)`,
    ).run({
        g,
        tipo: "movie",
        anio: null,
        section_id: "1",
        biblioteca: "Películas",
        encontrada: 1,
        actualizada: Date.now(),
        ...f,
        generos: JSON.stringify(f.generos || []),
        directores: JSON.stringify(f.directores || []),
        colecciones: JSON.stringify(f.colecciones || []),
        temporadas: f.temporadas ? JSON.stringify(f.temporadas) : null,
    });
}
const peli = (g, key, titulo, anio, extra = {}) => ficha(g, { rating_key: key, titulo, anio, ...extra });
const serie = (g, key, titulo, temporadas, extra = {}) =>
    ficha(g, { rating_key: key, tipo: "show", titulo, temporadas, section_id: "2", biblioteca: "Series", ...extra });
function ver(g, user, f) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, porcentaje, visto)
         VALUES (@g, @id, @user, @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio, 3600, 100, @visto)`,
    ).run({
        g,
        id: filaId++,
        user: String(user),
        tipo: "movie",
        rating_key: null,
        serie_key: null,
        titulo: null,
        serie: null,
        temporada: null,
        episodio: null,
        anio: null,
        inicio: 1_780_000_000 + filaId,
        visto: 1,
        ...f,
    });
}
const verPeli = (g, user, key, titulo, anio, extra = {}) => ver(g, user, { rating_key: key, titulo, anio, ...extra });
const verEps = (g, user, serieKey, titulo, eps, extra = {}) =>
    eps.forEach(([t, e]) =>
        ver(g, user, {
            tipo: "episode",
            rating_key: `${serieKey}-${t}-${e}`,
            serie_key: serieKey,
            serie: titulo,
            temporada: t,
            episodio: e,
            ...extra,
        }),
    );
const bibliotecaCompleta = (g) =>
    db
        .prepare(
            "INSERT INTO plex_sync (guildId, ultimo_inicio, biblioteca_revisada) VALUES (?, 0, ?) ON CONFLICT(guildId) DO UPDATE SET biblioteca_revisada = excluded.biblioteca_revisada",
        )
        .run(g, Date.now());
const vincular = (g, ...users) => users.forEach((u) => plexLinks.setLink(g, `disc-${u}`, String(u), `u${u}`));
async function trofeosDe(g, user = 1) {
    const r = await plexHistorial.actualizarLogros(g);
    return r
        .find((x) => x.discordUserId === `disc-${user}`)
        .desbloqueados.map((a) => a.id)
        .filter((id) => id.startsWith("plext:"))
        .sort();
}
const catalogo = (g) => new Map(achievements.getCatalog(g).map((a) => [a.id, a]));

beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.GOOGLE_API_KEY;
});

describe("series", () => {
    test("una serie vuelta a añadir con otra clave: lo visto antes y después cuenta junto", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        serie(g, "vieja", "Dark", { 1: [1, 2] }, { encontrada: 0 });
        serie(g, "nueva", "Dark", { 1: [1, 2], 2: [1] });
        verEps(g, 1, "vieja", "Dark", [
            [1, 1],
            [1, 2],
        ]);
        verEps(g, 1, "nueva", "Dark", [[2, 1]]);
        expect(await trofeosDe(g)).toEqual(["plext:serie:nueva", "plext:temporada:nueva:1", "plext:temporada:nueva:2"]);
    });

    test("episodios a medias (sin 'visto'), especiales y temporadas incompletas no cuentan", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        serie(g, "s", "Lost", { 1: [1, 2], 2: [1, 2] });
        verEps(g, 1, "s", "Lost", [
            [0, 1],
            [1, 1],
            [1, 2],
            [2, 1],
        ]);
        verEps(g, 1, "s", "Lost", [[2, 2]], { visto: 0 });
        expect(await trofeosDe(g)).toEqual(["plext:temporada:s:1"]);
    });

    test("una serie de un solo episodio no da trofeo; sin ficha, tampoco", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        serie(g, "corta", "Especial de Navidad", { 1: [1] });
        verEps(g, 1, "corta", "Especial de Navidad", [[1, 1]]);
        verEps(g, 1, "sinficha", "Sin ficha", [
            [1, 1],
            [1, 2],
        ]);
        expect(await trofeosDe(g)).toEqual([]);
    });

    test("anime: cuentan series, episodios y terminadas de anime aparte; las de series normales, no", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        ["a1", "a2", "a3"].forEach((k) => serie(g, k, `Anime ${k}`, { 1: [1, 2] }, { section_id: "3", biblioteca: "Anime" }));
        serie(g, "normal", "Normal", { 1: [1, 2] });
        verEps(g, 1, "a1", "Anime a1", [
            [1, 1],
            [1, 2],
        ]);
        verEps(g, 1, "a2", "Anime a2", [[1, 1]]);
        verEps(g, 1, "a3", "Anime a3", [[1, 2]]);
        verEps(g, 1, "normal", "Normal", [
            [1, 1],
            [1, 2],
        ]);
        const r = await plexHistorial.actualizarLogros(g);
        const ids = r[0].desbloqueados.map((a) => a.id);
        expect(ids).toEqual(expect.arrayContaining(["plex_anime_series_3", "plex_anime_completas_1", "plex_completas_1"]));
        const datos = plexTrofeos.datosUsuario(g, "1", plexTrofeos.contexto(g));
        expect(datos.cuentas).toEqual({ animePeliculas: 0, animeSeries: 3, animeEpisodios: 4, animeCompletas: 1, seriesCompletas: 1 });
        expect(catalogo(g).get("plext:serie:a1")).toMatchObject({ anime: true, emoji: "🎌" });
    });
});

describe("películas", () => {
    test("la misma película en dos bibliotecas (normal y 4K) cuenta una vez, también para 'todas las de…'", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        bibliotecaCompleta(g);
        for (const [k, t, a] of [
            ["d1", "Alien", 1979],
            ["d2", "Blade Runner", 1982],
            ["d3", "Gladiator", 2000],
        ]) {
            peli(g, k, t, a, { directores: ["Ridley Scott"] });
            peli(g, `${k}-4k`, t, a, { directores: ["Ridley Scott"], section_id: "5", biblioteca: "Películas 4K" });
        }
        verPeli(g, 1, "d1", "Alien", 1979);
        verPeli(g, 1, "d2-4k", "Blade Runner", 1982);
        expect(await trofeosDe(g)).toEqual([]);
        verPeli(g, 1, "d3", "Gladiator", 2000);
        expect(await trofeosDe(g)).toEqual(["plext:director:ridley-scott"]);
        expect(catalogo(g).get("plext:director:ridley-scott").desc).toBe("Ve todas las películas de Ridley Scott que hay en Plex (3)");
    });

    test("directores con menos de 3 películas no dan trofeo; sagas: de 2 a 40", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        bibliotecaCompleta(g);
        peli(g, "x1", "X1", 2001, { directores: ["Dos Pelis"], colecciones: ["Saga de una"] });
        peli(g, "x2", "X2", 2002, { directores: ["Dos Pelis"], colecciones: ["Saga de dos"] });
        peli(g, "x3", "X3", 2003, { colecciones: ["Saga de dos"] });
        for (let i = 0; i < 41; i++) peli(g, `g${i}`, `Gigante ${i}`, 1990, { colecciones: ["Top 41"] });
        ["x1", "x2", "x3"].forEach((k, i) => verPeli(g, 1, k, `X${i + 1}`, 2001 + i));
        for (let i = 0; i < 41; i++) verPeli(g, 1, `g${i}`, `Gigante ${i}`, 1990);
        const t = await trofeosDe(g);
        expect(t.filter((id) => /director|saga/.test(id))).toEqual(["plext:saga:saga-de-dos"]);
    });

    test("sin la biblioteca entera, ni directores ni sagas; en cuanto está, salen", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        ["a", "b", "c"].forEach((k) => peli(g, k, k, 2010, { directores: ["Villeneuve"], colecciones: ["Trilogía"] }));
        ["a", "b", "c"].forEach((k) => verPeli(g, 1, k, k, 2010));
        expect(await trofeosDe(g)).toEqual([]);
        bibliotecaCompleta(g);
        peli(g, "pendiente", "Pendiente", 2011, { actualizada: 0 });
        expect(await trofeosDe(g)).toEqual([]);
        db.prepare("UPDATE plex_fichas SET actualizada = ? WHERE guildId = ? AND rating_key = 'pendiente'").run(Date.now(), g);
        expect(await trofeosDe(g)).toEqual(["plext:director:villeneuve", "plext:saga:trilogia"]);
    });

    test("géneros: una vez por película aunque venga en dos idiomas; a las 25, el de experto", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        for (let i = 0; i < 25; i++) {
            peli(g, `t${i}`, `T${i}`, 2015, { generos: ["Terror", "Horror"] });
            verPeli(g, 1, `t${i}`, `T${i}`, 2015);
        }
        const datos = plexTrofeos.datosUsuario(g, "1", plexTrofeos.contexto(g));
        expect(datos.porGenero.get("terror").n).toBe(25);
        expect(await trofeosDe(g)).toEqual(["plext:genero:terror:10", "plext:genero:terror:25"]);
        const cat = catalogo(g);
        expect(cat.get("plext:genero:terror:25")).toMatchObject({ name: "Sin pegar ojo · Experto", rewardCoins: 1000 });
        expect(cat.get("plext:genero:terror:10")).toMatchObject({ rewardCoins: 400 });
    });

    test("un género sin nombre propio se llama 'Fan del género…'", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        for (let i = 0; i < 10; i++) {
            peli(g, `k${i}`, `K${i}`, 2015, { generos: ["Artes marciales"] });
            verPeli(g, 1, `k${i}`, `K${i}`, 2015);
        }
        await trofeosDe(g);
        expect(catalogo(g).get("plext:genero:artes-marciales:10").name).toBe("Fan del género Artes marciales");
    });

    test("décadas: solo antes de 2000; los años 20 con el año entero", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        for (let i = 0; i < 10; i++) {
            peli(g, `v${i}`, `V${i}`, 1920 + i);
            peli(g, `m${i}`, `M${i}`, 2010 + i);
            verPeli(g, 1, `v${i}`, `V${i}`, 1920 + i);
            verPeli(g, 1, `m${i}`, `M${i}`, 2010 + i);
        }
        expect(await trofeosDe(g)).toEqual(["plext:decada:1920"]);
        expect(catalogo(g).get("plext:decada:1920")).toMatchObject({
            name: "Máquina del tiempo: los 20",
            desc: "Ve 10 películas de los años 1920",
        });
    });

    test("películas de anime: por la biblioteca; una saga de anime lleva 🎌", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        bibliotecaCompleta(g);
        peli(g, "dbz1", "Dragon Ball Z: La batalla", 2013, {
            section_id: "4",
            biblioteca: "Películas Anime",
            colecciones: ["Dragon Ball"],
        });
        peli(g, "dbz2", "Dragon Ball Super: Broly", 2018, { section_id: "4", biblioteca: "Películas Anime", colecciones: ["Dragon Ball"] });
        verPeli(g, 1, "dbz1", "Dragon Ball Z: La batalla", 2013);
        verPeli(g, 1, "dbz2", "Dragon Ball Super: Broly", 2018);
        const r = await plexHistorial.actualizarLogros(g);
        expect(r[0].desbloqueados.map((a) => a.id)).toEqual(expect.arrayContaining(["plex_anime_pelis_1", "plext:saga:dragon-ball"]));
        expect(catalogo(g).get("plext:saga:dragon-ball")).toMatchObject({
            anime: true,
            emoji: "🎌",
            desc: "🎌 Ve todas las películas de la colección Dragon Ball (2)",
        });
    });
});

describe("Gemini", () => {
    function preparar(g) {
        vincular(g, 1);
        serie(g, "bb", "Breaking Bad", { 1: [1], 2: [1] });
        verEps(g, 1, "bb", "Breaking Bad", [
            [1, 1],
            [2, 1],
        ]);
    }

    test("si falla, se quedan los nombres por defecto (y no se vuelve a preguntar por esos)", async () => {
        const g = nuevoGuild();
        preparar(g);
        process.env.GOOGLE_API_KEY = "x";
        gemini.generateContentWithTimeout.mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED"));
        await trofeosDe(g);
        expect(catalogo(g).get("plext:serie:bb").name).toBe("Breaking Bad: completada");
        expect(db.prepare("SELECT nombre_ia FROM plex_trofeos WHERE guildId = ? AND id = 'serie:bb'").get(g).nombre_ia).toBe(0);
        await trofeosDe(g);
        expect(gemini.generateContentWithTimeout).toHaveBeenCalledTimes(1);
    });

    test("JSON roto, ids inventados, nombres vacíos o larguísimos: solo vale lo bueno", async () => {
        const g = nuevoGuild();
        preparar(g);
        process.env.GOOGLE_API_KEY = "x";
        gemini.generateContentWithTimeout.mockResolvedValue({
            text:
                '```json\n{"serie:bb": "  «Say my name»\\n ", "temporada:bb:1": "", "inventado:1": "Nada", "temporada:bb:2": "' +
                "x".repeat(100) +
                '"}\n```',
        });
        await trofeosDe(g);
        const cat = catalogo(g);
        expect(cat.get("plext:serie:bb").name).toBe("Say my name");
        expect(cat.get("plext:temporada:bb:1").name).toBe("Breaking Bad: temporada 1");
        expect(cat.get("plext:temporada:bb:2").name).toHaveLength(60);
        expect(achievements.getCatalog(g).some((a) => a.id.includes("inventado"))).toBe(false);

        const g2 = nuevoGuild();
        preparar(g2);
        gemini.generateContentWithTimeout.mockResolvedValue({ text: "no es json" });
        await trofeosDe(g2);
        expect(catalogo(g2).get("plext:serie:bb").name).toBe("Breaking Bad: completada");
    });

    test("también acepta una lista [{ id, nombre }] y el texto en candidates", async () => {
        const g = nuevoGuild();
        preparar(g);
        process.env.GOOGLE_API_KEY = "x";
        gemini.generateContentWithTimeout.mockResolvedValue({
            candidates: [{ content: { parts: [{ text: '[{"id": "serie:bb", "nombre": "Heisenberg"}]' }] } }],
        });
        await trofeosDe(g);
        expect(catalogo(g).get("plext:serie:bb").name).toBe("Heisenberg");
    });

    test("sin GOOGLE_API_KEY no se llama", async () => {
        const g = nuevoGuild();
        preparar(g);
        await trofeosDe(g);
        expect(gemini.generateContentWithTimeout).not.toHaveBeenCalled();
    });

    test("en lotes de 40 y como mucho 150 por sincronización; el modelo es el del Duende", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        guildSettings.setSetting(g, "duende.model", "modelo-del-panel");
        for (let i = 0; i < 160; i++) {
            serie(g, `s${i}`, `Serie ${i}`, { 1: [1, 2] });
            verEps(g, 1, `s${i}`, `Serie ${i}`, [
                [1, 1],
                [1, 2],
            ]);
        }
        process.env.GOOGLE_API_KEY = "x";
        gemini.generateContentWithTimeout.mockImplementation(async ({ contents }) => {
            const ids = [...contents[0].parts[0].text.matchAll(/^(\S+:\S+) → /gm)].map((m) => m[1]);
            return { text: JSON.stringify(Object.fromEntries(ids.map((id) => [id, `IA ${id}`]))) };
        });
        await trofeosDe(g);
        const lotes = gemini.generateContentWithTimeout.mock.calls.map(
            ([p]) => [...p.contents[0].parts[0].text.matchAll(/^(\S+:\S+) → /gm)].length,
        );
        expect(lotes).toEqual([40, 40, 40, 30]);
        expect(gemini.generateContentWithTimeout.mock.calls[0][0]).toMatchObject({
            model: "modelo-del-panel",
            config: { responseMimeType: "application/json" },
        });
        const conIA = db.prepare("SELECT COUNT(*) AS n FROM plex_trofeos WHERE guildId = ? AND nombre_ia = 1").get(g).n;
        expect(conIA).toBe(150);
        expect(db.prepare("SELECT COUNT(*) AS n FROM plex_trofeos WHERE guildId = ?").get(g).n).toBe(160);
    });
});

describe("trofeos de admin: cada condición", () => {
    let g;
    beforeAll(() => {
        g = nuevoGuild();
        vincular(g, 1, 2);
        bibliotecaCompleta(g);
        for (let i = 0; i < 3; i++)
            peli(g, `nolan${i}`, `Nolan ${i}`, 2000 + i, {
                directores: ["Christopher Nolan"],
                generos: ["Drama"],
                colecciones: ["Batman"],
            });
        for (let i = 0; i < 4; i++) peli(g, `ochenta${i}`, `Ochenta ${i}`, 1984, { generos: ["Comedia"] });
        peli(g, "ghibli", "Mi vecino Totoro", 1988, { section_id: "4", biblioteca: "Películas Anime" });
        serie(g, "bb", "Breaking Bad", { 1: [1, 2], 2: [1] });
        serie(g, "aot", "Shingeki", { 1: [1, 2] }, { section_id: "3", biblioteca: "Anime" });
        for (let i = 0; i < 2; i++) verPeli(g, 1, `nolan${i}`, `Nolan ${i}`, 2000 + i);
        for (let i = 0; i < 4; i++) verPeli(g, 1, `ochenta${i}`, `Ochenta ${i}`, 1984);
        verPeli(g, 1, "ghibli", "Mi vecino Totoro", 1988);
        verEps(g, 1, "bb", "Breaking Bad", [
            [1, 1],
            [1, 2],
        ]);
        verEps(g, 1, "aot", "Shingeki", [
            [1, 1],
            [1, 2],
        ]);
    });

    test.each([
        ["genero:Comedia 3", 4, 3],
        ["genero:Comedy 5", 4, 5],
        ["decada:1980 5", 5, 5],
        ["director:Nolan", 2, 3],
        ["director:Christopher Nolan 2", 2, 2],
        ["director:Desconocido", 0, 1],
        ["saga:Batman", 2, 3],
        ["serie:Breaking Bad", 2, 3],
        ["serie:breaking", 2, 3],
        ["serie:No existe", 0, 1],
        ["pelicula:Mi vecino Totoro", 1, 1],
        ["pelicula:Titanic", 0, 1],
        ["peliculas 5", 7, 5],
        ["episodios 10", 4, 10],
        ["horas 3", 11, 3],
        ["series-completas 1", 0, 1],
        ["anime-peliculas 1", 1, 1],
        ["anime-series 1", 1, 1],
        ["anime-episodios 2", 2, 2],
        ["anime-completas 1", 1, 1],
    ])("%s → progreso %i de %i", async (condicion, progreso, objetivo) => {
        const r = plexTrofeos.crearAdmin(g, { nombre: condicion, condicion, recompensa: "10" }, "admin");
        expect(r.ok).toBe(true);
        await plexHistorial.actualizarLogros(g);
        const a = achievements.listUserAchievements(g, "disc-1").find((x) => x.id === `plext:${r.trofeo.id}`);
        expect(a).toMatchObject({ progress: progreso, target: objetivo, completed: progreso >= objetivo });
        // Quien no ha visto nada lo ve igual (los de admin no se esconden), a 0.
        expect(achievements.listUserAchievements(g, "disc-2").find((x) => x.id === `plext:${r.trofeo.id}`)).toMatchObject({ progress: 0 });
        plexTrofeos.borrar(g, r.trofeo.id);
    });

    test("'todas las de…' sin la biblioteca entera no avanza; el objetivo sigue a la biblioteca", async () => {
        const r = plexTrofeos.crearAdmin(g, { nombre: "Nolanista", condicion: "director:Nolan", recompensa: "10" }, "admin");
        db.prepare("UPDATE plex_sync SET biblioteca_revisada = NULL WHERE guildId = ?").run(g);
        await plexHistorial.actualizarLogros(g);
        expect(achievements.listUserAchievements(g, "disc-1").find((x) => x.id === `plext:${r.trofeo.id}`)).toMatchObject({
            progress: 0,
            target: 1,
        });
        bibliotecaCompleta(g);
        peli(g, "nolan3", "Nolan 3", 2003, { directores: ["Christopher Nolan"] });
        await plexHistorial.actualizarLogros(g);
        expect(achievements.listUserAchievements(g, "disc-1").find((x) => x.id === `plext:${r.trofeo.id}`)).toMatchObject({
            progress: 2,
            target: 4,
        });
        plexTrofeos.borrar(g, r.trofeo.id);
    });

    test("validación al crear", () => {
        const crear = (o) => plexTrofeos.crearAdmin(g, { nombre: "X", condicion: "peliculas 1", recompensa: "1", ...o }, "admin");
        expect(crear({ nombre: "   " })).toEqual({ ok: false, error: "Falta el nombre." });
        expect(crear({ recompensa: "mucho" }).ok).toBe(false);
        expect(crear({ recompensa: "-5" }).ok).toBe(false);
        expect(crear({ recompensa: "2000000" }).ok).toBe(false);
        expect(crear({ condicion: "" }).ok).toBe(false);
        const largo = crear({ nombre: "N".repeat(80), descripcion: "D".repeat(300) });
        expect(largo.trofeo.nombre).toHaveLength(60);
        expect(largo.trofeo.descripcion).toHaveLength(200);
        expect(crear({ recompensa: "1.000" }).trofeo.recompensa).toBe(1000);
        expect(crear({ condicion: "anime-completas 3" }).trofeo.descripcion).toBe("Termina 3 series de anime");
        // Muchos seguidos (en el mismo milisegundo): cada uno con su id.
        const ids = Array.from({ length: 5 }, () => crear({}).trofeo.id);
        expect(new Set(ids).size).toBe(5);
    });

    test("borrar uno que no existe dice que no; reclamar uno borrado, tampoco", async () => {
        expect(plexTrofeos.borrar(g, "admin:noexiste")).toBe(false);
        const r = plexTrofeos.crearAdmin(g, { nombre: "Temporal", condicion: "peliculas 1", recompensa: "5" }, "admin");
        await plexHistorial.actualizarLogros(g);
        plexTrofeos.borrar(g, r.trofeo.id);
        expect(achievements.claimAchievement(g, "disc-1", `plext:${r.trofeo.id}`)).toEqual({ ok: false, msg: "Logro no existe." });
    });
});

describe("logros", () => {
    test("con la categoría plex o los logros desactivados no se crean trofeos ni se llama a Gemini", async () => {
        for (const [clave, valor] of [
            ["logros.disabled_categories", "casino, plex"],
            ["logros.enabled", "false"],
        ]) {
            const g = nuevoGuild();
            vincular(g, 1);
            serie(g, "s", "S", { 1: [1, 2] });
            verEps(g, 1, "s", "S", [
                [1, 1],
                [1, 2],
            ]);
            guildSettings.setSetting(g, clave, valor);
            process.env.GOOGLE_API_KEY = "x";
            await plexHistorial.actualizarLogros(g);
            expect(db.prepare("SELECT COUNT(*) AS n FROM plex_trofeos WHERE guildId = ?").get(g).n).toBe(0);
            expect(gemini.generateContentWithTimeout).not.toHaveBeenCalled();
        }
    });

    test("los trofeos de un servidor no salen en otro", async () => {
        const g1 = nuevoGuild();
        const g2 = nuevoGuild();
        vincular(g1, 1);
        serie(g1, "s", "S", { 1: [1, 2] });
        verEps(g1, 1, "s", "S", [
            [1, 1],
            [1, 2],
        ]);
        await plexHistorial.actualizarLogros(g1);
        expect(catalogo(g1).has("plext:serie:s")).toBe(true);
        expect(catalogo(g2).has("plext:serie:s")).toBe(false);
    });

    test("cuentan en el ranking de logros y en 'reclamar todo'", async () => {
        const g = nuevoGuild();
        vincular(g, 1);
        serie(g, "s", "S", { 1: [1, 2], 2: [1, 2] });
        verEps(g, 1, "s", "S", [
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2],
        ]);
        await plexHistorial.actualizarLogros(g);
        expect(achievements.getTopUsers(g)[0]).toMatchObject({ userId: "disc-1", completed: 4 }); // serie, 2 temporadas y "Créditos finales"
        const r = achievements.claimAll(g, "disc-1");
        // Serie de 4 episodios (250 + 10 × 4), dos temporadas de 2 (100 + 5 × 2) y "Créditos finales".
        expect(r).toMatchObject({ ok: true, count: 4, reward: 290 + 110 + 110 + 400 });
    });

    test("applyEvents: sumas y máximos juntos, y no reescribe un máximo ya completo sin cambios", async () => {
        const g = nuevoGuild();
        const r1 = await achievements.applyEvents(g, "u", [
            { event: "message_count", value: 1 },
            { event: "plex_peliculas", value: 1 },
            { event: "no_existe", value: 5 },
            { value: 3 },
        ]);
        expect(r1.map((a) => a.id).sort()).toEqual(["plex_pelis_1", "primer_mensaje"]);
        const antes = db
            .prepare("SELECT progress FROM achievements_progress WHERE guildId = ? AND userId = 'u' AND achievementId = 'plex_pelis_1'")
            .get(g);
        await achievements.applyEvents(g, "u", [{ event: "plex_peliculas", value: 1 }]);
        expect(
            db
                .prepare("SELECT progress FROM achievements_progress WHERE guildId = ? AND userId = 'u' AND achievementId = 'plex_pelis_1'")
                .get(g),
        ).toEqual(antes);
        await achievements.applyEvents(g, "u", [{ event: "message_count", value: 1 }]);
        expect(achievements.listUserAchievements(g, "u").find((a) => a.id === "charlatan_100").progress).toBe(2);
        expect(await achievements.applyEvents(g, "u", null)).toEqual([]);
        expect(await achievements.applyEvents(null, "u", [{ event: "message_count" }])).toEqual([]);
    });

    test("rareza: textos y sin vinculados", () => {
        expect(plexTrofeos.textoRareza(undefined)).toBe("nadie lo tiene todavía");
        expect(plexTrofeos.textoRareza(10)).toBe("solo el 10 % del servidor lo tiene");
        expect(plexTrofeos.textoRareza(11)).toBe("lo tiene el 11 % del servidor");
        expect(plexTrofeos.rarezas(nuevoGuild())).toEqual(new Map());
        const sinTrofeos = [{ id: "x", name: "X" }];
        expect(plexTrofeos.paraAnuncio(nuevoGuild(), sinTrofeos)).toBe(sinTrofeos);
    });
});
