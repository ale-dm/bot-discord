// 🎲 Ruleta de películas (#576): la tirada de systems/plexRuleta (nunca lo visto, filtros, 🎬 Otra sin repetir), la
// pantalla de paneles/plexRuleta y sus botones y menús en /plex → ⭐ Reseñas. BD en memoria con una biblioteca sembrada a
// mano (fichas, historial y vínculos). Tautulli y Seerr van mockeados para comprobar que ninguna tirada los llama.
jest.mock("../src/services/tautulliClient", () => ({
    getLibraryMediaInfo: jest.fn(),
    getMetadata: jest.fn(),
    getHistory: jest.fn(),
    getLibraries: jest.fn(),
}));
jest.mock("../src/services/seerrClient", () => ({ getMediaStatus: jest.fn(), searchMulti: jest.fn() }));

const Database = require("better-sqlite3");
const { runMigrations } = require("../src/core/migrations");
const db = require("../src/core/db");
const tautulli = require("../src/services/tautulliClient");
const seerrClient = require("../src/services/seerrClient");
const plexLinks = require("../src/systems/plexLinks");
const plexAvisos = require("../src/systems/plexAvisos");
const plexResenas = require("../src/systems/plexResenas");
const plexRuleta = require("../src/systems/plexRuleta");
const { pantallaRuleta, estadoId, leerEstado } = require("../src/paneles/plexRuleta");
const { pantallaResenas } = require("../src/paneles/plexResenas");
const plexCmd = require("../src/commands/plex/plex");

const G = "guild-ruleta";
const VACIO = "guild-ruleta-vacio";
const DURACION = "guild-ruleta-duracion";
const SIN_VER = ["k3", "k4", "k5", "k7"];
let filaId = 1;

function ficha(f) {
    db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, encontrada, actualizada, tmdb)
         VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, '[]', ?, ?, ?)`,
    ).run(
        f.guild || G,
        f.key,
        f.tipo || "movie",
        f.titulo,
        f.anio,
        f.biblioteca || "Películas",
        JSON.stringify(f.generos || []),
        JSON.stringify(f.directores || []),
        f.encontrada ?? 1,
        f.actualizada ?? 1,
        f.tmdb || null,
    );
    if (f.duracion !== undefined)
        db.prepare("UPDATE plex_fichas SET duracion = ? WHERE guildId = ? AND rating_key = ?").run(f.duracion, f.guild || G, f.key);
}

function ver(tautulliUserId, key, titulo, anio, visto = 1) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 7200, ?, ?)`,
    ).run(G, filaId++, String(tautulliUserId), key, titulo, anio, 1_700_000_000 + filaId, visto ? 100 : 30, visto);
}

/** Las claves que salen con cada valor del azar de 0 a 0,95 (de 0,05 en 0,05). */
function todasLasTiradas(userId, opciones = {}, guildId = G) {
    const salen = new Set();
    for (let i = 0; i < 20; i++) salen.add(plexRuleta.tirar(guildId, userId, { ...opciones, azar: () => i / 20 }).pelicula?.ratingKey);
    return salen;
}

const filas = (p) => p.components.map((f) => f.toJSON());
const ids = (p) => filas(p).flatMap((f) => f.components.map((c) => c.custom_id));
const boton = (p, id) =>
    filas(p)
        .flatMap((f) => f.components)
        .find((c) => c.custom_id === id || String(c.custom_id).startsWith(id));

beforeAll(() => {
    plexLinks.setLink(G, "u1", "1", "uno");
    plexLinks.setLink(G, "u3", "3", "tres");
    ficha({ key: "k1", titulo: "Alien", anio: 1979, generos: ["Ciencia ficción", "Terror"], tmdb: 348 });
    ficha({ key: "k2", titulo: "Heat", anio: 1995, generos: ["Acción", "Crimen"], tmdb: 949 });
    ficha({
        key: "k3",
        titulo: "Arrival",
        anio: 2016,
        generos: ["Ciencia ficción", "Drama"],
        directores: ["Denis Villeneuve"],
        tmdb: 329865,
    });
    ficha({ key: "k4", titulo: "The Thing", anio: 1982, generos: ["Horror"], tmdb: 1091 });
    ficha({ key: "k5", titulo: "Dune", anio: 2021, generos: ["Ciencia ficción"] });
    // La misma Dune en la biblioteca 4K, todavía sin ficha: cuenta una vez.
    ficha({ key: "k6", titulo: "Dune", anio: 2021, biblioteca: "Películas 4K", actualizada: 0 });
    // Conocida por el repaso de la biblioteca (get_library_media_info) pero sin ficha aún: sin géneros.
    ficha({ key: "k7", titulo: "Pendiente", anio: 2001, actualizada: 0 });
    ficha({ key: "k8", titulo: "Borrada", anio: 1990, generos: ["Drama"], encontrada: 0 });
    ficha({ key: "k9", tipo: "show", titulo: "Dark", anio: 2017, generos: ["Ciencia ficción"] });
    // u1 ha visto Alien, y Heat en otra copia (otra clave de Plex, mismo título y año). Arrival la dejó a medias.
    ver(1, "k1", "Alien", 1979);
    ver(1, "viejo-heat", "Heat", 1995);
    ver(1, "k3", "Arrival", 2016, 0);
    // u3 lo ha visto todo.
    for (const [k, t, a] of [
        ["k1", "Alien", 1979],
        ["k2", "Heat", 1995],
        ["k3", "Arrival", 2016],
        ["k4", "The Thing", 1982],
        ["k5", "Dune", 2021],
        ["k7", "Pendiente", 2001],
    ])
        ver(3, k, t, a);
});

afterEach(() => jest.clearAllMocks());

describe("la tirada", () => {
    test("nunca propone lo que ya ha visto (ni en otra copia), ni series, ni lo que ya no está en Plex", () => {
        const salen = todasLasTiradas("u1");
        expect([...salen].sort()).toEqual(SIN_VER);
    });

    test("lo empezado y no terminado (Tautulli no lo da por visto) sí puede salir", () => {
        expect(todasLasTiradas("u1")).toContain("k3");
    });

    test("la misma película en dos bibliotecas cuenta una vez, la que tiene ficha", () => {
        const r = plexRuleta.tirar(G, "u1", { filtros: { genero: "ciencia-ficcion" }, azar: () => 0.99 });
        expect(r.total).toBe(2);
        expect(todasLasTiradas("u1")).not.toContain("k6");
    });

    test("sin la cuenta de Plex vinculada no tira y explica por qué", () => {
        const r = plexRuleta.tirar(G, "u-sin-vinculo");
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/vinculada/);
    });

    test("sin películas en las fichas avisa de que falta sincronizar", () => {
        plexLinks.setLink(VACIO, "u1", "1", "uno");
        const r = plexRuleta.tirar(VACIO, "u1");
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/sincroniza/);
    });

    test("si lo ha visto todo, lo dice", () => {
        const r = plexRuleta.tirar(G, "u3");
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/todas/);
    });
});

describe("los filtros", () => {
    test("el género filtra, y «Horror» cuenta como Terror", () => {
        expect([...todasLasTiradas("u1", { filtros: { genero: "terror" } })]).toEqual(["k4"]);
        expect([...todasLasTiradas("u1", { filtros: { genero: "ciencia-ficcion" } })].sort()).toEqual(["k3", "k5"]);
    });

    test("la década filtra (también lo que aún no tiene ficha, por su año)", () => {
        expect([...todasLasTiradas("u1", { filtros: { decada: 1980 } })]).toEqual(["k4"]);
        expect([...todasLasTiradas("u1", { filtros: { decada: 2000 } })]).toEqual(["k7"]);
    });

    test("lo que aún no tiene ficha no sale al filtrar por género", () => {
        expect(todasLasTiradas("u1", { filtros: { genero: "drama" } })).toEqual(new Set(["k3"]));
    });

    test("filtros que no dejan nada: sin película y con total 0", () => {
        const r = plexRuleta.tirar(G, "u1", { filtros: { genero: "ciencia-ficcion", decada: 1980 } });
        expect(r.ok).toBe(true);
        expect(r.pelicula).toBeNull();
        expect(r.total).toBe(0);
    });

    test("los menús solo ofrecen lo que hay sin ver con los otros filtros", () => {
        const r = plexRuleta.tirar(G, "u1", { azar: () => 0 });
        expect(r.facetas.generos.map((g) => [g.id, g.n])).toEqual([
            ["ciencia-ficcion", 2],
            ["drama", 1],
            ["terror", 1],
        ]);
        expect(r.facetas.decadas.map((d) => d.decada)).toEqual([2020, 2010, 2000, 1980]);
        const conDecada = plexRuleta.tirar(G, "u1", { filtros: { decada: 2010 }, azar: () => 0 });
        expect(conDecada.facetas.generos.map((g) => g.id)).toEqual(["ciencia-ficcion", "drama"]);
    });

    test("la duración máxima deja fuera lo más largo y lo que no se sabe cuánto dura", () => {
        const f = { genero: "", decada: 0, duracion: 120 };
        expect(plexRuleta.cumple({ generos: [], anio: 2000, duracion: 100 }, f)).toBe(true);
        expect(plexRuleta.cumple({ generos: [], anio: 2000, duracion: 150 }, f)).toBe(false);
        expect(plexRuleta.cumple({ generos: [], anio: 2000, duracion: null }, f)).toBe(false);
    });

    test("el menú de duración solo sale cuando las fichas traen la duración", () => {
        const sin = plexRuleta.facetas([{ generos: [], anio: 2000, duracion: null }], plexRuleta.SIN_FILTROS);
        const con = plexRuleta.facetas([{ generos: [], anio: 2000, duracion: 100 }], plexRuleta.SIN_FILTROS);
        expect(sin.duraciones).toEqual([]);
        expect(con.duraciones).toEqual(plexRuleta.DURACIONES);
    });

    test("los filtros que no se entienden se ignoran", () => {
        expect(plexRuleta.normalizarFiltros({ genero: "DROP TABLE", decada: "1985", duracion: "45" })).toEqual(plexRuleta.SIN_FILTROS);
        expect(plexRuleta.normalizarFiltros({ genero: "terror", decada: "1980", duracion: "90" })).toEqual({
            genero: "terror",
            decada: 1980,
            duracion: 90,
        });
    });
});

describe("la duración máxima, con la biblioteca sembrada", () => {
    beforeAll(() => {
        plexLinks.setLink(DURACION, "u1", "1", "uno");
        ficha({ guild: DURACION, key: "d1", titulo: "Corta", anio: 2000, duracion: 95 });
        ficha({ guild: DURACION, key: "d2", titulo: "Media", anio: 2000, duracion: 130 });
        ficha({ guild: DURACION, key: "d3", titulo: "Sin duración", anio: 2000 });
        ficha({ guild: DURACION, key: "d4", titulo: "Justa", anio: 2000, duracion: 150 });
        ficha({ guild: DURACION, key: "d5", titulo: "Eterna", anio: 2000, duracion: 200 });
    });

    test("la migración 078 añade plex_fichas.duracion y se puede volver a pasar", () => {
        const otra = new Database(":memory:");
        runMigrations(otra);
        expect(
            otra
                .prepare("PRAGMA table_info(plex_fichas)")
                .all()
                .map((c) => c.name),
        ).toContain("duracion");
        otra.prepare("DELETE FROM schema_migrations WHERE version = 78").run();
        expect(runMigrations(otra)).toBe(1);
        otra.close();
    });

    test("excluye lo que dura más que el máximo y lo que no se sabe cuánto dura", () => {
        expect(todasLasTiradas("u1", { filtros: { duracion: 120 } }, DURACION)).toEqual(new Set(["d1"]));
        expect([...todasLasTiradas("u1", { filtros: { duracion: 150 } }, DURACION)].sort()).toEqual(["d1", "d2", "d4"]);
        expect([...todasLasTiradas("u1", {}, DURACION)].sort()).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    });

    test("con duraciones en las fichas sale el menú, y elegir una la aplica", async () => {
        const p = pantallaRuleta(DURACION, "u1", plexRuleta.tirar(DURACION, "u1", { azar: () => 0 }));
        const menu = filas(p)
            .flatMap((f) => f.components)
            .find((c) => String(c.custom_id).startsWith("plex_sel_ruleta_duracion_"));
        expect(menu.options.map((o) => o.value)).toEqual(["todos", "90", "120", "150"]);
        expect(menu.options.map((o) => o.label)).toEqual(["⏱️ Sin límite de duración", "Hasta 1 h 30", "Hasta 2 h", "Hasta 2 h 30"]);

        const i = { customId: "plex_sel_ruleta_duracion__0_0_", guildId: DURACION, user: { id: "u1" }, values: ["120"], update: jest.fn() };
        await plexCmd.handleSelect({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().title).toBe("🎲 Corta (2000)");
        expect(i.update.mock.calls[0][0].embeds[0].toJSON().description).toMatch(/hasta 2 h/);
    });

    test("en la biblioteca sin duraciones no sale el menú de duración", () => {
        const p = pantallaRuleta(G, "u1", plexRuleta.tirar(G, "u1", { azar: () => 0 }));
        expect(ids(p).some((id) => id.startsWith("plex_sel_ruleta_duracion_"))).toBe(false);
    });
});

describe("🎬 Otra", () => {
    test("no repite la anterior, salga el azar que salga", () => {
        expect(todasLasTiradas("u1", { filtros: { genero: "ciencia-ficcion" }, anterior: "k3" })).toEqual(new Set(["k5"]));
        expect(todasLasTiradas("u1", { filtros: { genero: "ciencia-ficcion" }, anterior: "k5" })).toEqual(new Set(["k3"]));
    });

    test("si es la única que queda, lo dice en vez de proponer otra", () => {
        const r = plexRuleta.tirar(G, "u1", { filtros: { genero: "terror" }, anterior: "k4" });
        expect(r.unica).toBe(true);
        const p = pantallaRuleta(G, "u1", r);
        expect(p.embeds[0].toJSON().description).toMatch(/única/);
        expect(boton(p, "plex_ruleta_otra_").disabled).toBe(true);
    });
});

describe("la pantalla", () => {
    // azar 0: la primera sin ver por clave de Plex, Arrival (k3).
    const arrival = () => plexRuleta.tirar(G, "u1", { azar: () => 0 });

    test("respeta los límites de Discord: 5 filas, 5 botones por fila, ids únicos de 100 caracteres como mucho", () => {
        const p = pantallaRuleta(
            G,
            "u1",
            plexRuleta.tirar(G, "u1", { filtros: { genero: "ciencia-ficcion", decada: 2010 }, azar: () => 0 }),
        );
        expect(filas(p).length).toBeLessThanOrEqual(5);
        for (const f of filas(p)) expect(f.components.length).toBeLessThanOrEqual(5);
        expect(new Set(ids(p)).size).toBe(ids(p).length);
        for (const id of ids(p)) expect(id.length).toBeLessThanOrEqual(100);
    });

    test("la ficha enseña el título, los géneros, el director y la media del servidor", () => {
        db.prepare(
            `INSERT INTO plex_resenas (guildId, userId, clave, tipo, titulo, anio, nota, creado_en, actualizado_en)
             VALUES (?, 'u2', ?, 'movie', 'Arrival', 2016, 8, 1, 1)`,
        ).run(G, plexResenas.clavePeli("Arrival", 2016));
        const e = pantallaRuleta(G, "u1", arrival()).embeds[0].toJSON();
        expect(e.title).toBe("🎲 Arrival (2016)");
        expect(e.description).toContain("Ciencia ficción, Drama");
        expect(e.description).toContain("Denis Villeneuve");
        expect(e.description).toMatch(/4 ★\*\* en el servidor · 1 voto/);
        expect(e.description).toMatch(/entre 4 películas que no has visto/);
    });

    test("⭐ Puntuar va desactivado (se puntúa al verla) y 📝 Quiero ver, activo si la ficha trae TMDB", () => {
        const p = pantallaRuleta(G, "u1", arrival());
        expect(boton(p, "plex_ruleta_puntuar").disabled).toBe(true);
        expect(boton(p, "plex_ruleta_quiero_").disabled).toBeFalsy();
        expect(p.embeds[0].toJSON().footer.text).toMatch(/Se puntúa al verla/);
    });

    test("sin id de TMDB en la ficha, 📝 Quiero ver va desactivado", () => {
        const dune = plexRuleta.tirar(G, "u1", { filtros: { decada: 2020 } });
        expect(dune.pelicula.ratingKey).toBe("k5");
        expect(boton(pantallaRuleta(G, "u1", dune), "plex_ruleta_quiero_").disabled).toBe(true);
    });

    test("los menús marcan el filtro elegido", () => {
        const p = pantallaRuleta(G, "u1", plexRuleta.tirar(G, "u1", { filtros: { genero: "terror" } }));
        const menu = filas(p)
            .flatMap((f) => f.components)
            .find((c) => c.custom_id.startsWith("plex_sel_ruleta_genero_"));
        expect(menu.options.find((o) => o.default).value).toBe("terror");
        expect(menu.options[0].value).toBe("todos");
    });

    test("sin nada con esos filtros ofrece 🧹 Quitar filtros", () => {
        const p = pantallaRuleta(G, "u1", plexRuleta.tirar(G, "u1", { filtros: { genero: "ciencia-ficcion", decada: 1980 } }));
        expect(p.embeds[0].toJSON().description).toMatch(/No queda ninguna/);
        expect(ids(p)).toContain("plex_ruleta_otra__0_0_");
    });

    test("si no puede tirar, solo enseña el motivo y ⬅️ Reseñas", () => {
        const p = pantallaRuleta(G, "u-sin-vinculo", plexRuleta.tirar(G, "u-sin-vinculo"));
        expect(ids(p)).toEqual(["plex_resenas"]);
    });

    test("el estado del customId va y vuelve, y lo raro se descarta", () => {
        const id = estadoId("plex_ruleta_otra_", { genero: "ciencia-ficcion", decada: 2010, duracion: 0 }, "k3");
        expect(id).toBe("plex_ruleta_otra_ciencia-ficcion_2010_0_k3");
        expect(leerEstado(id.slice("plex_ruleta_otra_".length))).toEqual({
            filtros: { genero: "ciencia-ficcion", decada: 2010, duracion: 0 },
            ratingKey: "k3",
        });
        expect(leerEstado("x$y_abc_9_k 1")).toEqual({ filtros: plexRuleta.SIN_FILTROS, ratingKey: null });
    });

    test("⭐ Reseñas lleva 🎲 Ruleta en otra fila y la primera sigue con 5 botones", () => {
        const p = pantallaResenas(G, "u1");
        const f = filas(p);
        expect(f[0].components).toHaveLength(5);
        expect(f[0].components.map((c) => c.custom_id)).not.toContain("plex_ruleta");
        expect(ids(p)).toContain("plex_ruleta");
        for (const fila of f) expect(fila.components.length).toBeLessThanOrEqual(5);
    });
});

describe("los botones y los menús", () => {
    const interaccion = (customId, userId = "u1", extra = {}) => ({
        customId,
        guildId: G,
        user: { id: userId },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        ...extra,
    });
    const pintado = (i) => i.update.mock.calls[0][0];

    afterEach(() => {
        db.prepare("DELETE FROM plex_quiero_ver WHERE guildId = ?").run(G);
        jest.restoreAllMocks();
    });

    test("🎲 Ruleta tira una película sin ver sin llamar a Tautulli ni a Seerr", async () => {
        const i = interaccion("plex_ruleta");
        await plexCmd.handleButton({}, i);
        const titulo = pintado(i).embeds[0].toJSON().title;
        expect(titulo).toMatch(/^🎲 (Arrival|The Thing|Dune|Pendiente)/);
        for (const fn of [...Object.values(tautulli), ...Object.values(seerrClient)]) expect(fn).not.toHaveBeenCalled();
    });

    test("🎬 Otra no repite la que había en pantalla", async () => {
        const i = interaccion("plex_ruleta_otra_ciencia-ficcion_0_0_k3");
        await plexCmd.handleButton({}, i);
        expect(pintado(i).embeds[0].toJSON().title).toBe("🎲 Dune (2021)");
    });

    test("elegir un género en el menú aplica el filtro, y «todos» lo quita", async () => {
        const i = interaccion("plex_sel_ruleta_genero__0_0_k3", "u1", { values: ["terror"] });
        await plexCmd.handleSelect({}, i);
        expect(pintado(i).embeds[0].toJSON().title).toBe("🎲 The Thing (1982)");

        jest.spyOn(Math, "random").mockReturnValue(0); // con todo, la primera sin ver que no es The Thing: Arrival
        const t = interaccion("plex_sel_ruleta_genero_terror_0_0_k4", "u1", { values: ["todos"] });
        await plexCmd.handleSelect({}, t);
        expect(pintado(t).embeds[0].toJSON().title).toBe("🎲 Arrival (2016)");
    });

    test("elegir una década en el menú aplica el filtro", async () => {
        const i = interaccion("plex_sel_ruleta_decada__0_0_", "u1", { values: ["2000"] });
        await plexCmd.handleSelect({}, i);
        expect(pintado(i).embeds[0].toJSON().title).toBe("🎲 Pendiente (2001)");
    });

    test("📝 Quiero ver la apunta en la lista, ya como disponible en Plex, y el botón pasa a ✅", async () => {
        const i = interaccion("plex_ruleta_quiero__0_0_k3");
        await plexCmd.handleButton({}, i);
        const fila = db.prepare("SELECT * FROM plex_quiero_ver WHERE guildId = ? AND userId = 'u1'").get(G);
        expect(fila).toMatchObject({ media_type: "movie", tmdb_id: 329865, titulo: "Arrival", anio: "2016" });
        expect(fila.disponible_en).not.toBeNull();
        const p = pintado(i);
        expect(p.embeds[0].toJSON().title).toBe("🎲 Arrival (2016)");
        expect(p.embeds[0].toJSON().description).toMatch(/apuntada/);
        expect(boton(p, "plex_ruleta_quiero_")).toMatchObject({ label: "✅ En tu lista", disabled: true });
        expect(seerrClient.getMediaStatus).not.toHaveBeenCalled();
    });

    test("📝 Quiero ver dos veces no la duplica", async () => {
        await plexCmd.handleButton({}, interaccion("plex_ruleta_quiero__0_0_k3"));
        const i = interaccion("plex_ruleta_quiero__0_0_k3");
        await plexCmd.handleButton({}, i);
        expect(pintado(i).embeds[0].toJSON().description).toMatch(/ya está en tu lista/);
        expect(plexAvisos.quieroVer(G, "u1")).toHaveLength(1);
    });

    test("📝 Quiero ver de una película ya vista no apunta nada y lo explica", async () => {
        const i = interaccion("plex_ruleta_quiero__0_0_k1");
        await plexCmd.handleButton({}, i);
        expect(pintado(i).embeds[0].toJSON().description).toMatch(/ya no está en la ruleta/);
        expect(plexAvisos.quieroVer(G, "u1")).toHaveLength(0);
    });

    test("⭐ Puntuar, si llega, contesta en privado que se puntúa al verla", async () => {
        const i = interaccion("plex_ruleta_puntuar");
        await plexCmd.handleButton({}, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/al verla/);
    });
});
