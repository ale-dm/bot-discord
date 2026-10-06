// 🍿 Trofeos de Plex, fases 2 y 3: fichas de Tautulli (biblioteca de películas y series vistas), trofeos de cada serie,
// temporada, saga y director, por género y década, separados en series y anime, con nombre de Gemini, rareza, los de
// admin y la opción de ocultarlos.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getHistoryPage: jest.fn(),
    getLibraries: jest.fn(),
    getLibraryMediaInfo: jest.fn(),
    getMetadata: jest.fn(),
    getChildrenMetadata: jest.fn(),
    getStreamData: jest.fn(async () => null),
}));
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(),
}));
const tautulli = require("../src/services/tautulliClient");
const gemini = require("../src/services/geminiClient");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexFichas = require("../src/systems/plexFichas");
const plexTrofeos = require("../src/systems/plexTrofeos");
const { buildPlexTrofeos, handlePlexButton, handlePlexModal, handlePlexStringSelect } = require("../src/adminPanel/plex");
const perfilPanel = require("../src/paneles/perfil");
const perfilCmd = require("../src/commands/progresion/perfil");

const G = "guild-trofeos";

// ─── La biblioteca de Plex ───────────────────────────────────────────────────
const LIBRERIAS = [
    { section_id: 1, section_name: "Películas", section_type: "movie", count: 15 },
    { section_id: 2, section_name: "Series", section_type: "show", count: 1 },
    { section_id: 3, section_name: "Anime", section_type: "show", count: 1 },
    { section_id: 4, section_name: "Películas Anime", section_type: "movie", count: 1 },
    { section_id: 5, section_name: "Música", section_type: "artist", count: 300 },
];
const PELICULAS = {};
const peli = (key, title, year, section, extra = {}) => {
    const lib = LIBRERIAS.find((l) => l.section_id === section);
    PELICULAS[key] = {
        rating_key: key,
        title,
        year,
        section_id: section,
        library_name: lib.section_name,
        genres: [],
        directors: [],
        collections: [],
        ...extra,
    };
};
peli("origen", "Origen", 2010, 1, { directors: ["Christopher Nolan"], genres: ["Ciencia ficción", "Acción"] });
peli("interstellar", "Interstellar", 2014, 1, { directors: ["Christopher Nolan"], genres: ["Ciencia ficción", "Drama"] });
peli("memento", "Memento", 2000, 1, { directors: ["Christopher Nolan"], genres: ["Misterio"] });
peli("hp1", "Harry Potter y la piedra filosofal", 2001, 1, {
    directors: ["Chris Columbus"],
    collections: ["Harry Potter"],
    genres: ["Fantasía"],
});
peli("hp2", "Harry Potter y la cámara secreta", 2002, 1, {
    directors: ["Chris Columbus"],
    collections: ["Harry Potter"],
    genres: ["Fantasía"],
});
// 10 de terror de los 80 (unas con el género en inglés: cuentan juntas).
for (let n = 0; n < 10; n++)
    peli(`terror${n}`, `Terror ${n}`, 1980 + n, 1, { directors: [`Director ${n}`], genres: [n % 2 ? "Horror" : "Terror"] });
peli("chihiro", "El viaje de Chihiro", 2001, 4, { directors: ["Hayao Miyazaki"], genres: ["Animación", "Fantasía"] });

const SERIES = {
    bb: { rating_key: "bb", title: "Breaking Bad", year: 2008, section_id: 2, library_name: "Series", genres: ["Drama", "Crimen"] },
    sk: { rating_key: "sk", title: "Ataque a los titanes", year: 2013, section_id: 3, library_name: "Anime", genres: ["Animación"] },
};
const HIJOS = {
    "bb|show": [
        { rating_key: "bb-s1", media_index: 1 },
        { rating_key: "bb-s2", media_index: 2 },
    ],
    "bb-s1|season": [{ media_index: 1 }, { media_index: 2 }, { media_index: 3 }],
    "bb-s2|season": [{ media_index: 1 }, { media_index: 2 }],
    // La temporada 0 (especiales) no cuenta.
    "sk|show": [
        { rating_key: "sk-s0", media_index: 0 },
        { rating_key: "sk-s1", media_index: 1 },
    ],
    "sk-s1|season": [{ media_index: 1 }, { media_index: 2 }],
};

function montarTautulli({ quitar = [] } = {}) {
    tautulli.getLibraries.mockImplementation(async () => LIBRERIAS);
    tautulli.getLibraryMediaInfo.mockImplementation(async (_g, sectionId) => {
        const filas = Object.values(PELICULAS)
            .filter((p) => String(p.section_id) === String(sectionId) && !quitar.includes(p.rating_key))
            .map((p) => ({ rating_key: p.rating_key, title: p.title, year: p.year }));
        return { filas, total: filas.length };
    });
    tautulli.getMetadata.mockImplementation(async (_g, key) => PELICULAS[key] || SERIES[key] || null);
    tautulli.getChildrenMetadata.mockImplementation(async (_g, key, tipo) => HIJOS[`${key}|${tipo}`] || []);
}

// ─── Lo que han visto ────────────────────────────────────────────────────────
let fila = 1;
const inicio = (n) => Date.UTC(2026, 5, 1) / 1000 + n * 3600;
const vistaPeli = (user, key, extra = {}) => ({
    row_id: fila++,
    user_id: user,
    media_type: "movie",
    rating_key: key,
    title: PELICULAS[key]?.title,
    year: PELICULAS[key]?.year,
    started: inicio(fila),
    play_duration: 6000,
    percent_complete: 100,
    watched_status: 1,
    ...extra,
});
const vistoEp = (user, serie, t, e) => ({
    row_id: fila++,
    user_id: user,
    media_type: "episode",
    rating_key: `${serie}-${t}-${e}`,
    grandparent_rating_key: serie,
    grandparent_title: SERIES[serie].title,
    title: `Episodio ${e}`,
    parent_media_index: t,
    media_index: e,
    started: inicio(fila),
    play_duration: 2700,
    percent_complete: 100,
    watched_status: 1,
});
const historial = (filas) => tautulli.getHistoryPage.mockImplementation(async (_g, { start }) => (start === 0 ? filas : []));

// Gemini pone "Say my name" a Breaking Bad y "IA <id>" al resto.
gemini.generateContentWithTimeout.mockImplementation(async ({ contents }) => {
    const prompt = contents[0].parts[0].text;
    const ids = [...prompt.matchAll(/^(\S+:\S+) → /gm)].map((m) => m[1]);
    return { text: JSON.stringify(Object.fromEntries(ids.map((id) => [id, id === "serie:bb" ? '"Say my name"' : `IA ${id}`]))) };
});

const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
const guild = { id: G, name: G, channels: { cache: new Map([["canal-logros", canal]]), fetch: async () => null } };
const anuncios = () => canal.send.mock.calls.map(([m]) => m.content);
const ids = (lista) => lista.map((a) => a.id).sort();

beforeAll(async () => {
    process.env.GOOGLE_API_KEY = "clave-de-prueba";
    // Aquí se prueba la recompensa de cada trofeo; la de la primera importación está en plexImportacion.test.js.
    guildSettings.setSetting(G, "plex.importacion_pct", 100);
    montarTautulli();
    historial([
        // Ana (8): las tres de Nolan (Origen con la clave de antes: se reconoce por título y año), las dos de Harry
        // Potter, las 10 de terror, Chihiro, Breaking Bad entera y Ataque a los titanes (una temporada) entera.
        vistaPeli(8, "origen", { rating_key: "origen-viejo" }),
        vistaPeli(8, "interstellar"),
        vistaPeli(8, "memento"),
        vistaPeli(8, "hp1"),
        vistaPeli(8, "hp2"),
        ...Array.from({ length: 10 }, (_, n) => vistaPeli(8, `terror${n}`)),
        vistaPeli(8, "chihiro"),
        ...[1, 2, 3].map((e) => vistoEp(8, "bb", 1, e)),
        ...[1, 2].map((e) => vistoEp(8, "bb", 2, e)),
        ...[1, 2].map((e) => vistoEp(8, "sk", 1, e)),
        // Luis (9): solo la primera temporada de Breaking Bad y dos de Nolan.
        ...[1, 2, 3].map((e) => vistoEp(9, "bb", 1, e)),
        vistaPeli(9, "origen"),
        vistaPeli(9, "memento"),
    ]);
    plexLinks.setLink(G, "disc-8", "8", "ana");
    plexLinks.setLink(G, "disc-9", "9", "luis");
    guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
    await plexHistorial.sincronizar(G);
});

describe("fichas", () => {
    test("repasa la biblioteca de películas y pide las fichas de las series vistas (sin especiales)", async () => {
        const r = await plexFichas.actualizar(G, { presupuesto: 1000 });
        expect(r).toMatchObject({ nuevasEnBiblioteca: 16, errores: 0, pendientes: 0 });
        expect(plexFichas.estado(G)).toMatchObject({ peliculas: 16, series: 2, pendientes: 0, completa: true });
        const { series, peliculas } = plexFichas.cargar(G);
        expect(series.find((s) => s.rating_key === "bb").temporadas).toEqual({ 1: [1, 2, 3], 2: [1, 2] });
        expect(series.find((s) => s.rating_key === "sk").temporadas).toEqual({ 1: [1, 2] });
        expect(peliculas.find((p) => p.rating_key === "origen")).toMatchObject({
            directores: ["Christopher Nolan"],
            biblioteca: "Películas",
        });
        // No se piden las bibliotecas de series ni la de música enteras.
        expect(tautulli.getLibraryMediaInfo.mock.calls.map(([, s]) => s).sort()).toEqual(["1", "4"]);
    });

    test("con el presupuesto gastado, deja el resto para la siguiente vez; lo ya pedido no se repite", async () => {
        tautulli.getMetadata.mockClear();
        const r = await plexFichas.actualizar(G, { presupuesto: 5 });
        expect(r.llamadas).toBe(0); // la biblioteca se repasó hace nada y no falta nada
        expect(tautulli.getMetadata).not.toHaveBeenCalled();
    });

    test("anime: automático por el nombre de la biblioteca o el género; o las bibliotecas que elija un admin", () => {
        const auto = plexFichas.configAnime(G);
        expect(auto.auto).toBe(true);
        expect(plexFichas.esAnime({ biblioteca: "Películas Anime", generos: [] }, auto)).toBe(true);
        expect(plexFichas.esAnime({ biblioteca: "Series", generos: ["Anime"] }, auto)).toBe(true);
        expect(plexFichas.esAnime({ biblioteca: "Series", generos: ["Drama"] }, auto)).toBe(false);
        guildSettings.setSetting(G, "plex.bibliotecas_anime", "2");
        const elegidas = plexFichas.configAnime(G);
        expect(plexFichas.esAnime({ section_id: "2", biblioteca: "Series" }, elegidas)).toBe(true);
        expect(plexFichas.esAnime({ section_id: "3", biblioteca: "Anime" }, elegidas)).toBe(false);
        guildSettings.setSetting(G, "plex.bibliotecas_anime", "");
    });
});

describe("trofeos", () => {
    let resultado;
    beforeAll(async () => {
        resultado = await plexHistorial.actualizarLogros(guild);
    });
    const de = (u) => resultado.find((r) => r.discordUserId === u).desbloqueados;

    test("de cada serie, temporada, saga y director, por género y década, y los contadores de anime y series", () => {
        expect(ids(de("disc-8").filter((a) => a.trofeo))).toEqual([
            "plext:decada:1980",
            "plext:director:christopher-nolan",
            "plext:genero:terror:10",
            "plext:saga:harry-potter",
            "plext:serie:bb",
            "plext:serie:sk",
            "plext:temporada:bb:1",
            "plext:temporada:bb:2",
        ]);
        expect(ids(de("disc-8").filter((a) => /completas|anime/.test(a.id)))).toEqual([
            "plex_anime_completas_1",
            "plex_anime_pelis_1",
            "plex_completas_1",
        ]);
        // Luis solo tiene la primera temporada; le faltan Interstellar (Nolan) y la segunda temporada.
        expect(ids(de("disc-9").filter((a) => a.trofeo))).toEqual(["plext:temporada:bb:1"]);
    });

    test("el anime va aparte: Ataque a los titanes es una serie de anime (y no tiene trofeo de temporada: solo tiene una)", () => {
        const sk = achievements.getCatalog(G).find((a) => a.id === "plext:serie:sk");
        expect(sk).toMatchObject({ anime: true, emoji: "🎌", desc: "🎌 Termina Ataque a los titanes entera (2 episodios)" });
        expect(achievements.getCatalog(G).some((a) => a.id.startsWith("plext:temporada:sk"))).toBe(false);
        const bb = achievements.getCatalog(G).find((a) => a.id === "plext:serie:bb");
        expect(bb).toMatchObject({ anime: false, emoji: "📺" });
    });

    test("Gemini pone los nombres de una vez (sin comillas) y los trofeos de género y década llevan uno fijo", () => {
        expect(gemini.generateContentWithTimeout).toHaveBeenCalledTimes(1);
        const cat = new Map(achievements.getCatalog(G).map((a) => [a.id, a]));
        expect(cat.get("plext:serie:bb").name).toBe("Say my name");
        expect(cat.get("plext:director:christopher-nolan").name).toBe("IA director:christopher-nolan");
        expect(cat.get("plext:genero:terror:10")).toMatchObject({ name: "Sin pegar ojo", desc: "Ve 10 películas de Terror" });
        expect(cat.get("plext:decada:1980").name).toBe("Máquina del tiempo: los 80");
    });

    test("se anuncian con de qué son y lo raros que son; un mensaje por persona", () => {
        const [ana, luis] = [anuncios().find((m) => m.includes("<@disc-8>")), anuncios().find((m) => m.includes("<@disc-9>"))];
        expect(ana).toMatch(/🏅 \*\*Say my name\*\* — Termina Breaking Bad entera \(5 episodios\) · lo tiene el 50 % del servidor/);
        expect(ana).toMatch(/🏅 \*\*IA temporada:bb:1\*\* — Termina la temporada 1 de Breaking Bad · lo tiene el 100 % del servidor/);
        expect(luis).toMatch(/IA temporada:bb:1/);
        expect(anuncios().filter((m) => m.includes("<@disc-8>"))).toHaveLength(1);
        expect(plexTrofeos.textoRareza(8)).toBe("solo el 8 % del servidor lo tiene");
    });

    test("sin nada nuevo, no se anuncia ni se pregunta a Gemini otra vez", async () => {
        const antes = canal.send.mock.calls.length;
        await plexHistorial.actualizarLogros(guild);
        expect(canal.send.mock.calls.length).toBe(antes);
        expect(gemini.generateContentWithTimeout).toHaveBeenCalledTimes(1);
    });

    test("en el perfil, los de cada título solo los ve quien los tiene; se reclaman como cualquier logro", () => {
        const luis = achievements.listUserAchievements(G, "disc-9", { includeHidden: true }).map((a) => a.id);
        expect(luis).toContain("plext:temporada:bb:1");
        expect(luis).not.toContain("plext:serie:bb");
        const r = achievements.claimAchievement(G, "disc-8", "plext:serie:bb");
        expect(r).toMatchObject({ ok: true, reward: 300 }); // 250 + 10 por episodio
        const texto = perfilPanel.buildLogros(G, "disc-8", "disc-8", 0, false).embeds[0].data.description;
        expect(texto).toMatch(/🏆 (lo tiene|solo) el \d+ % del servidor/);
    });

    test("un trofeo nuevo de una serie a la vez: Luis termina Breaking Bad y se reutiliza el nombre", async () => {
        historial([...[1, 2].map((e) => vistoEp(9, "bb", 2, e))]);
        await plexHistorial.sincronizar(G);
        const [, luis] = await plexHistorial.actualizarLogros(guild).then((r) => [r[0], r.find((x) => x.discordUserId === "disc-9")]);
        expect(ids(luis.desbloqueados.filter((a) => a.trofeo))).toEqual(["plext:serie:bb", "plext:temporada:bb:2"]);
        expect(luis.desbloqueados.find((a) => a.id === "plext:serie:bb").name).toBe("Say my name");
        expect(gemini.generateContentWithTimeout).toHaveBeenCalledTimes(1);
        expect(anuncios().at(-1)).toMatch(/Say my name\*\* — Termina Breaking Bad entera \(5 episodios\) · lo tiene el 100 % del servidor/);
    });

    test("si una película sale de la biblioteca, deja de contar para 'todas las de…'", async () => {
        guildSettings.setSetting(G, "plex.bibliotecas_anime", "");
        montarTautulli({ quitar: ["interstellar"] });
        require("../src/core/db").prepare("UPDATE plex_sync SET biblioteca_revisada = 1 WHERE guildId = ?").run(G);
        await plexFichas.actualizar(G, { presupuesto: 100 });
        const ctx = plexTrofeos.contexto(G);
        expect([...ctx.directores.get("christopher-nolan").peliculas.keys()]).toHaveLength(2);
        montarTautulli();
        require("../src/core/db").prepare("UPDATE plex_sync SET biblioteca_revisada = 1 WHERE guildId = ?").run(G);
        await plexFichas.actualizar(G, { presupuesto: 100 });
        expect([...plexTrofeos.contexto(G).directores.get("christopher-nolan").peliculas.keys()]).toHaveLength(3);
    });
});

describe("trofeos de admin", () => {
    test("condiciones: tipos, valores y números", () => {
        const p = plexTrofeos.parsearCondicion;
        expect(p("genero:Terror 20")).toMatchObject({ ok: true, cond: { tipo: "genero", valor: "Terror", n: 20 } });
        expect(p("director:Christopher Nolan")).toMatchObject({
            ok: true,
            cond: { tipo: "director", valor: "Christopher Nolan", n: null },
        });
        expect(p("pelicula:Blade Runner 2049")).toMatchObject({
            ok: true,
            cond: { tipo: "pelicula", valor: "Blade Runner 2049", n: null },
        });
        expect(p("decada:1985 10")).toMatchObject({ ok: true, cond: { valor: "1980", n: 10 }, texto: "decada:1980 10" });
        expect(p("anime-peliculas 3")).toMatchObject({ ok: true, cond: { tipo: "anime-peliculas", n: 3 } });
        expect(p("genero:Terror").ok).toBe(false);
        expect(p("anime-peliculas:algo 3").ok).toBe(false);
        expect(p("decada:los ochenta 10").ok).toBe(false);
        expect(p("cosas:x 1")).toEqual({ ok: false, error: 'No conozco el tipo "cosas".' });
    });

    test("se crea desde el panel, se calcula para todos (con su progreso, visible) y sale en el panel", async () => {
        const reply = jest.fn(async () => {});
        const campos = { nombre: "Nolanista", condicion: "director:Nolan", recompensa: "1.500", descripcion: "" };
        const i = {
            customId: "paneladmin_plex_trofeo_modal",
            guildId: G,
            guild,
            user: { id: "admin-1", tag: "admin" },
            fields: { getTextInputValue: (k) => campos[k] },
            reply,
        };
        expect(await handlePlexModal(i)).toBe(true);
        expect(reply.mock.calls[0][0].content).toMatch(/✅ Trofeo \*\*Nolanista\*\* creado \(`director:Nolan`, 🪙 1500\)/);
        // El cálculo va sin esperar a la respuesta: se espera a que estén calculados Ana (lo tiene) y Luis (2 de 3).
        const de = (u) => achievements.listUserAchievements(G, u).find((a) => a.name === "Nolanista") || {};
        for (let n = 0; n < 100 && !(de("disc-8").completed && de("disc-9").progress === 2); n++)
            await new Promise((r) => setTimeout(r, 20));
        const t = achievements.getCatalog(G).find((a) => a.name === "Nolanista");
        expect(t).toMatchObject({
            target: 3,
            rewardCoins: 1500,
            soloCompletado: false,
            desc: "Ve todas las películas de Nolan que hay en Plex",
        });
        expect(achievements.listUserAchievements(G, "disc-8").find((a) => a.id === t.id)).toMatchObject({ completed: true });
        expect(achievements.listUserAchievements(G, "disc-9").find((a) => a.id === t.id)).toMatchObject({ completed: false, progress: 2 });
        expect(buildPlexTrofeos(G).embeds[0].data.description).toMatch(/• 🟡 \*\*Nolanista\*\* — `director:Nolan` · 🪙 1500 · lo tiene 1/);

        const mal = jest.fn(async () => {});
        await handlePlexModal({ ...i, fields: { getTextInputValue: (k) => ({ ...campos, condicion: "genero:Terror" })[k] }, reply: mal });
        expect(mal.mock.calls[0][0].content).toMatch(/^❌ Falta cuántos/);
    });

    test("el género se busca igual en español y en inglés", async () => {
        const r = plexTrofeos.crearAdmin(G, { nombre: "Gritón", condicion: "genero:Horror 10", recompensa: "0" }, "admin-1");
        expect(r.ok).toBe(true);
        await plexHistorial.actualizarLogros(guild);
        expect(achievements.listUserAchievements(G, "disc-8").find((a) => a.id === `plext:${r.trofeo.id}`)).toMatchObject({
            completed: true,
            progress: 10,
        });
    });

    test("borrar un trofeo lo quita del catálogo y del progreso", async () => {
        const t = plexTrofeos.resumen(G).admin.find((x) => x.nombre === "Gritón");
        const update = jest.fn(async () => {});
        await handlePlexStringSelect({
            customId: "paneladmin_plex_trofeo_borrar_select",
            guildId: G,
            user: { id: "admin-1" },
            values: [t.id],
            update,
        });
        expect(update.mock.calls[0][0].content).toBe("✅ Trofeo borrado.");
        expect(achievements.getCatalog(G).some((a) => a.id === `plext:${t.id}`)).toBe(false);
    });
});

describe("panel y preferencias", () => {
    test("🏆 Trofeos: fichas, anime, creados por tipo; y elegir las bibliotecas de anime", async () => {
        const d = buildPlexTrofeos(G).embeds[0].data.description;
        expect(d).toMatch(/📚 Fichas: \*\*16\*\* películas de la biblioteca · \*\*2\*\* series vistas · \*\*0\*\* pendientes/);
        expect(d).toMatch(/"Todas las de…" y sagas: ✅ activos/);
        expect(d).toMatch(/🎌 Anime: automático/);
        expect(d).toMatch(/📺 series \*\*2\*\*/);

        const update = jest.fn(async () => {});
        await handlePlexButton({ customId: "paneladmin_plex_trofeos", guildId: G, update });
        expect(update.mock.calls[0][0].embeds[0].data.title).toBe("🏆 Trofeos de Plex");

        const reply = jest.fn(async () => {});
        await handlePlexButton({ customId: "paneladmin_plex_anime", guildId: G, reply });
        const opciones = reply.mock.calls[0][0].components[0].components[0].options.map((o) => o.data.label);
        expect(opciones).toEqual(["🤖 Automático", "Películas", "Series", "Anime", "Películas Anime"]);

        const sel = jest.fn(async () => {});
        await handlePlexStringSelect({
            customId: "paneladmin_plex_anime_select",
            guildId: G,
            user: { id: "admin-1" },
            values: ["3", "4"],
            update: sel,
        });
        expect(guildSettings.getSettings(G).plex.bibliotecas_anime).toBe("3,4");
        expect(buildPlexTrofeos(G).embeds[0].data.description).toMatch(/🎌 Anime: \*\*Anime\*\*, \*\*Películas Anime\*\*/);
        guildSettings.setSetting(G, "plex.bibliotecas_anime", "");
    });

    test("ocultar tus logros de Plex: no se anuncian y los demás no los ven en tu perfil", async () => {
        // El botón solo sale a quien tiene Plex vinculado, en su propio perfil.
        const propio = perfilPanel.buildLogros(G, "disc-9", "disc-9");
        const boton = propio.components[0].components.find((b) => b.data.custom_id.startsWith("perfil_plexoculto_"));
        expect(boton.data).toMatchObject({ custom_id: "perfil_plexoculto_disc-9_disc-9_1", label: "🍿 Ocultar mis logros de Plex" });
        expect(
            perfilPanel
                .buildLogros(G, "otro", "otro")
                .components[0].components.some((b) => b.data.custom_id.startsWith("perfil_plexoculto_")),
        ).toBe(false);

        const update = jest.fn(async () => {});
        await perfilCmd.handleButton(null, { customId: boton.data.custom_id, user: { id: "disc-9" }, guild, guildId: G, update });
        expect(update.mock.calls[0][0].content).toMatch(/^🙈/);
        expect(plexTrofeos.oculto(G, "disc-9")).toBe(true);

        const ajeno = perfilPanel.buildLogros(G, "disc-8", "disc-9", 0, true).embeds[0].data.description;
        expect(ajeno).not.toMatch(/\(plex/);
        expect(perfilPanel.buildLogros(G, "disc-9", "disc-9", 0, true).embeds[0].data.description).toMatch(/\(plex · /);

        // Luis ve 10 películas más de terror: el trofeo sale, pero no se anuncia.
        const antes = canal.send.mock.calls.length;
        historial(Array.from({ length: 10 }, (_, n) => vistaPeli(9, `terror${n}`)));
        await plexHistorial.sincronizar(G);
        const r = await plexHistorial.actualizarLogros(guild);
        expect(r.find((x) => x.discordUserId === "disc-9").desbloqueados.map((a) => a.id)).toContain("plext:genero:terror:10");
        expect(canal.send.mock.calls.length).toBe(antes);
        plexTrofeos.setOculto(G, "disc-9", false);
    });

    test("un anuncio con muchísimos logros no pasa del límite de Discord", async () => {
        const muchos = Array.from({ length: 80 }, (_, n) => ({
            id: `x${n}`,
            name: `Trofeo con un nombre largo número ${n}`,
            detalleAnuncio: "Termina una serie muy larga · lo tiene el 50 %",
        }));
        canal.send.mockClear();
        await achievements.anunciarLogros(guild, "disc-8", muchos);
        const { content } = canal.send.mock.calls[0][0];
        expect(content.length).toBeLessThan(2000);
        expect(content).toMatch(/\n…y \d+ más\nReclámalos/);
    });
});
