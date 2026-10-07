// 🍿 Logros de Plex por idioma y por dificultad: reconocer el idioma del audio y de los subtítulos, en qué versiones
// cuenta cada reproducción (series, películas y anime), la revisión poco a poco desde Tautulli, los 51 logros fijos,
// el trofeo de serie entera en un idioma, la dificultad (fácil, normal, Gordo del Plex) en el catálogo, el perfil, el
// anuncio y los trofeos de admin, y las condiciones de idioma.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getStreamData: jest.fn(),
}));
const tautulli = require("../src/services/tautulliClient");
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexIdiomas = require("../src/systems/plexIdiomas");
const plexTrofeos = require("../src/systems/plexTrofeos");
const perfilPanel = require("../src/paneles/perfil");
const { buildPlexTrofeos, handlePlexModal } = require("../src/adminPanel/plex");

let n = 0;
let filaId = 1;
const nuevoGuild = () => `guild-idiomas-${++n}`;

function ficha(g, f) {
    db.prepare(
        `INSERT OR REPLACE INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, temporadas, encontrada, actualizada)
         VALUES (@g, @rating_key, @tipo, @titulo, @anio, @section_id, @biblioteca, '[]', '[]', '[]', @temporadas, 1, @actualizada)`,
    ).run({
        g,
        tipo: "movie",
        anio: 2000,
        section_id: "1",
        biblioteca: "Películas",
        actualizada: Date.now(),
        ...f,
        temporadas: f.temporadas ? JSON.stringify(f.temporadas) : null,
    });
}
const serie = (g, key, titulo, temporadas, anime = false) =>
    ficha(g, { rating_key: key, tipo: "show", titulo, temporadas, section_id: anime ? "3" : "2", biblioteca: anime ? "Anime" : "Series" });
const peli = (g, key, titulo, anime = false) =>
    ficha(g, { rating_key: key, titulo, section_id: anime ? "4" : "1", biblioteca: anime ? "Películas Anime" : "Películas" });
function ver(g, user, f) {
    const id = filaId++;
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, porcentaje, visto, audio, subs, idioma_revisado)
         VALUES (@g, @id, @user, @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio, 1500, 100, @visto, @audio, @subs, @revisado)`,
    ).run({
        g,
        id,
        user: String(user),
        tipo: "movie",
        rating_key: null,
        serie_key: null,
        titulo: null,
        serie: null,
        temporada: null,
        episodio: null,
        anio: 2000,
        inicio: 1_780_000_000 + id,
        visto: 1,
        audio: null,
        subs: null,
        revisado: 1,
        ...f,
    });
    return id;
}
const verEps = (g, user, key, titulo, eps, audio, subs, extra = {}) =>
    eps.map(([t, e]) =>
        ver(g, user, {
            tipo: "episode",
            rating_key: `${key}-${t}-${e}`,
            serie_key: key,
            serie: titulo,
            temporada: t,
            episodio: e,
            audio,
            subs,
            ...extra,
        }),
    );
const verPeli = (g, user, key, titulo, audio, subs) => ver(g, user, { rating_key: key, titulo, audio, subs });
const todos = (temporadas) => Object.entries(temporadas).flatMap(([t, eps]) => eps.map((e) => [Number(t), e]));
const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
async function calcular(g, user = 1) {
    const r = await plexHistorial.actualizarLogros(g);
    return r.find((x) => x.discordUserId === `disc-${user}`).desbloqueados;
}
const ids = (lista) => lista.map((a) => a.id).sort();

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_API_KEY;
});

describe("idioma del audio y de los subtítulos", () => {
    test.each([
        ["spa", "", "es"],
        ["", "Español", "es"],
        ["", "Spanish", "es"],
        ["", "Castellano", "es"],
        ["es-ES", "", "es"],
        ["spa", "Español (Latinoamérica)", "lat"],
        ["", "Spanish (Latin America)", "lat"],
        ["es-419", "Español", "lat"],
        ["", "Latino", "lat"],
        ["eng", "", "en"],
        ["en-US", "", "en"],
        ["", "English", "en"],
        ["", "Inglés", "en"],
        ["jpn", "", "ja"],
        ["", "Japanese", "ja"],
        ["", "Japonés", "ja"],
        ["", "日本語", "ja"],
        ["fre", "Français", "otro"],
        ["", "", null],
        [null, undefined, null],
    ])("código %p y nombre %p → %p", (codigo, nombre, esperado) => {
        expect(plexIdiomas.codigoIdioma(codigo, nombre)).toBe(esperado);
    });

    test("de get_stream_data: el audio que se oyó (el del stream antes que el original) y los subtítulos que se vieron", () => {
        const d = plexIdiomas.idiomaDe;
        expect(
            d({ stream_audio_language_code: "jpn", audio_language_code: "spa", subtitles: 1, stream_subtitle_language: "Español" }),
        ).toEqual({ audio: "ja", subs: "es" });
        expect(d({ audio_language_code: "eng", audio_language: "English", subtitles: 0 })).toEqual({ audio: "en", subs: "no" });
        expect(d({ audio_language: "English", subtitles: "1", subtitle_language: "English" })).toEqual({ audio: "en", subs: "en" });
        // Subtítulos en latino cuentan como subtítulos en español; los forzados no cuentan; sin idioma, "otro".
        expect(d({ audio_language_code: "jpn", subtitles: 1, stream_subtitle_language: "Spanish (Latin America)" }).subs).toBe("es");
        expect(d({ audio_language_code: "eng", subtitles: 1, stream_subtitle_language: "Español", stream_subtitle_forced: 1 }).subs).toBe(
            "no",
        );
        expect(d({ audio_language_code: "eng", subtitles: 1, subtitle_forced: "1", subtitle_language: "Español" }).subs).toBe("no");
        expect(d({ audio_language_code: "eng", subtitles: 1 }).subs).toBe("otro");
        expect(d({ subtitles: 0 })).toEqual({ audio: null, subs: "no" });
        expect(d(null)).toEqual({ audio: null, subs: null });
    });

    test("versiones: series y películas por un lado, anime por otro", () => {
        const m = (a, s, anime = false) => plexIdiomas.modosDe(a, s, anime).sort();
        expect(m("en", "no")).toEqual(["ingles", "ingles_sin_subs"]);
        expect(m("en", "es")).toEqual(["ingles", "vose"]);
        expect(m("en", "en")).toEqual(["ingles"]);
        expect(m("en", "otro")).toEqual(["ingles"]);
        expect(m("es", "no")).toEqual(["castellano"]);
        expect(m("lat", "no")).toEqual([]);
        expect(m("ja", "es")).toEqual([]); // japonés en algo que no es anime: ninguna
        expect(m("es", "no", true)).toEqual(["anime_castellano"]);
        expect(m("ja", "es", true)).toEqual(["anime_jap_sub_es"]);
        expect(m("ja", "en", true)).toEqual(["anime_jap_sub_en"]);
        expect(m("ja", "no", true)).toEqual(["anime_jap_sin_subs"]);
        expect(m("en", "es", true)).toEqual(["anime_ingles"]);
        expect(m("ja", "otro", true)).toEqual([]);
        expect(m(null, "es", true)).toEqual([]);
    });

    test("las versiones se escriben con su slug (sin tildes ni mayúsculas, con _ o -)", () => {
        expect(plexIdiomas.modoPorSlug("VOSE")).toBe("vose");
        expect(plexIdiomas.modoPorSlug("ingles-sin-subs")).toBe("ingles_sin_subs");
        expect(plexIdiomas.modoPorSlug("inglés")).toBe("ingles");
        expect(plexIdiomas.modoPorSlug("anime_jap_sub_es")).toBe("anime_jap_sub_es");
        expect(plexIdiomas.modoPorSlug("klingon")).toBeNull();
        expect(new Set(Object.values(plexIdiomas.MODOS).map((x) => x.slug)).size).toBe(9);
    });
});

describe("dificultad", () => {
    test.each([
        ["", "normal"],
        [undefined, "normal"],
        ["fácil", "facil"],
        ["FACIL", "facil"],
        ["f", "facil"],
        ["1", "facil"],
        ["Normal", "normal"],
        ["2", "normal"],
        ["gordo", "gordo"],
        ["Gordo del Plex", "gordo"],
        ["difícil", "gordo"],
        ["3", "gordo"],
        ["imposible", null],
    ])("%p → %p", (texto, esperado) => {
        expect(plexIdiomas.leerDificultad(texto)).toBe(esperado);
    });

    test("textos", () => {
        expect(plexIdiomas.textoDificultad("facil")).toBe("🟢 Fácil");
        expect(plexIdiomas.textoDificultad("normal")).toBe("🟡 Normal");
        expect(plexIdiomas.textoDificultad("gordo")).toBe("🎰 Gordo del Plex");
        expect(plexIdiomas.textoDificultad("otra")).toBe("");
    });
});

describe("los 51 logros fijos por idioma", () => {
    const fijos = plexIdiomas.logrosFijos();

    test("están en el catálogo, con ids únicos, su evento, dificultad y descripción", () => {
        expect(fijos).toHaveLength(51);
        expect(new Set(fijos.map((a) => a.id)).size).toBe(51);
        for (const a of fijos) {
            expect(achievements.CATALOG).toContainEqual(a);
            expect(a).toMatchObject({ category: "plex", metric: "max" });
            expect(["facil", "normal", "gordo"]).toContain(a.dificultad);
            expect(a.rewardCoins).toBeGreaterThan(0);
        }
        // Cada versión tiene logros de episodios y de series enteras, y las tres dificultades se usan.
        for (const modo of Object.keys(plexIdiomas.MODOS)) {
            expect(fijos.some((a) => a.event === plexIdiomas.evento("eps", modo))).toBe(true);
            expect(fijos.some((a) => a.event === plexIdiomas.evento("series", modo))).toBe(true);
        }
        expect(new Set(fijos.map((a) => a.dificultad))).toEqual(new Set(["facil", "normal", "gordo"]));
    });

    test("descripciones", () => {
        const d = (id) => fijos.find((a) => a.id === id).desc;
        expect(d("plex_en_eps_10")).toBe("Ve 10 episodios distintos en inglés");
        expect(d("plex_vose_pelis_5")).toBe("Ve 5 películas distintas en VOSE (inglés con subtítulos en castellano)");
        expect(d("plex_es_series_1")).toBe("Termina una serie entera en castellano");
        expect(d("plex_es_series_5")).toBe("Termina 5 series enteras en castellano");
        expect(d("plex_anime_jpes_eps_12")).toBe("Ve 12 episodios distintos de anime en japonés con subtítulos en castellano");
        expect(d("plex_anime_jp_puro_series_1")).toBe("Termina una serie de anime entera en japonés sin subtítulos");
    });

    test("cuanto más difícil, más recompensa dentro de cada versión y tipo", () => {
        const orden = { facil: 0, normal: 1, gordo: 2 };
        const grupos = new Map();
        for (const a of fijos) {
            if (!grupos.has(a.event)) grupos.set(a.event, []);
            grupos.get(a.event).push(a);
        }
        for (const lista of grupos.values()) {
            const ordenada = [...lista].sort((a, b) => a.target - b.target);
            for (let i = 1; i < ordenada.length; i++) {
                expect(ordenada[i].rewardCoins).toBeGreaterThan(ordenada[i - 1].rewardCoins);
                expect(orden[ordenada[i].dificultad]).toBeGreaterThanOrEqual(orden[ordenada[i - 1].dificultad]);
            }
        }
    });
});

describe("revisión de idiomas desde Tautulli", () => {
    test("solo lo visto por los vinculados, lo más reciente primero, sin pasarse del presupuesto", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        const vieja = ver(g, 1, { rating_key: "a", revisado: 0, inicio: 1000 });
        const nueva = ver(g, 1, { rating_key: "b", revisado: 0, inicio: 2000 });
        ver(g, 1, { rating_key: "c", revisado: 0, visto: 0 }); // a medias: no
        ver(g, 7, { rating_key: "d", revisado: 0 }); // sin vincular: no
        tautulli.getStreamData.mockImplementation(async (_g, id) =>
            id === nueva ? { stream_audio_language_code: "eng", subtitles: 1, stream_subtitle_language: "Spanish" } : null,
        );
        const r = await plexIdiomas.actualizar(g, { presupuesto: 1 });
        expect(r).toMatchObject({ llamadas: 1, revisadas: 1, pendientes: 1 });
        expect(tautulli.getStreamData.mock.calls.map(([, id]) => id)).toEqual([nueva]);
        const fila = (id) =>
            db.prepare("SELECT audio, subs, idioma_revisado FROM plex_reproducciones WHERE guildId = ? AND id = ?").get(g, id);
        expect(fila(nueva)).toEqual({ audio: "en", subs: "es", idioma_revisado: 1 });
        await plexIdiomas.actualizar(g);
        // Sin datos en Tautulli (de antes de Tautulli): revisada, sin idioma.
        expect(fila(vieja)).toEqual({ audio: null, subs: null, idioma_revisado: 1 });
        expect(plexIdiomas.estado(g)).toEqual({ revisadas: 2, pendientes: 0 });
    });

    test("con fallos de red seguidos para y deja lo demás pendiente", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        for (let i = 0; i < 20; i++) ver(g, 1, { rating_key: `x${i}`, revisado: 0 });
        tautulli.getStreamData.mockRejectedValue(new Error("ECONNRESET"));
        const r = await plexIdiomas.actualizar(g);
        expect(r.revisadas).toBe(0);
        expect(r.errores).toBeGreaterThanOrEqual(5);
        expect(r.errores).toBeLessThan(5 + 4);
        expect(plexIdiomas.estado(g).pendientes).toBe(20);
    });

    test("sin vinculados no hace nada", async () => {
        const g = nuevoGuild();
        ver(g, 1, { rating_key: "a", revisado: 0 });
        expect(await plexIdiomas.actualizar(g)).toEqual({ llamadas: 0, revisadas: 0, errores: 0, pendientes: 0 });
        expect(tautulli.getStreamData).not.toHaveBeenCalled();
    });

    test("en la sincronización, después de las fichas; con los logros de Plex desactivados, no", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        ver(g, 1, { rating_key: "a", revisado: 0 });
        tautulli.getStreamData.mockResolvedValue({ audio_language_code: "spa" });
        jest.spyOn(tautulli, "getHistoryPage").mockResolvedValue([]);
        jest.spyOn(tautulli, "getLibraries").mockResolvedValue([]);
        require("../src/systems/guildSettings").setSetting(g, "logros.disabled_categories", "plex");
        const r1 = await plexHistorial.sincronizarYCalcular({ id: g });
        expect(r1.idiomas).toBeNull();
        require("../src/systems/guildSettings").setSetting(g, "logros.disabled_categories", "");
        const r2 = await plexHistorial.sincronizarYCalcular({ id: g }, { boton: true });
        expect(r2.idiomas).toMatchObject({ revisadas: 1, pendientes: 0 });
        jest.restoreAllMocks();
    });
});

describe("logros y trofeos por idioma", () => {
    const BB = { 1: [1, 2, 3], 2: [1, 2] };

    test("una serie entera en inglés: trofeo de la serie en inglés, 'The End' y los contadores de episodios", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        serie(g, "bb", "Breaking Bad", BB);
        verEps(g, 1, "bb", "Breaking Bad", todos(BB), "en", "no");
        const d = await calcular(g);
        expect(ids(d).filter((id) => /idioma|_en_|_puro_/.test(id))).toEqual([
            "plex_en_puro_series_1",
            "plex_en_series_1",
            "plext:idioma:bb:ingles",
            "plext:idioma:bb:ingles_sin_subs",
        ]);
        const t = achievements.getCatalog(g).find((a) => a.id === "plext:idioma:bb:ingles");
        expect(t).toMatchObject({
            name: "Breaking Bad en inglés",
            desc: "🇬🇧 Termina Breaking Bad entera en inglés (5 episodios)",
            rewardCoins: 300 + 15 * 5,
            dificultad: "normal",
            emoji: "🇬🇧",
            soloCompletado: true,
        });
        const eps = achievements.listUserAchievements(g, "disc-1").find((a) => a.id === "plex_en_eps_10");
        expect(eps).toMatchObject({ progress: 5, completed: false });
    });

    test("un episodio en castellano rompe la serie en inglés, pero cuenta en los dos idiomas", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        serie(g, "bb", "Breaking Bad", BB);
        verEps(g, 1, "bb", "Breaking Bad", todos(BB).slice(0, 4), "en", "es");
        verEps(g, 1, "bb", "Breaking Bad", [[2, 2]], "es", "no");
        const d = await calcular(g);
        expect(ids(d).filter((id) => id.startsWith("plext:idioma"))).toEqual([]);
        const datos = plexTrofeos.datosUsuario(g, "1", plexTrofeos.contexto(g));
        expect(datos.cuentas.idioma.ingles).toEqual({ eps: 4, pelis: 0, series: 0 });
        expect(datos.cuentas.idioma.vose).toEqual({ eps: 4, pelis: 0, series: 0 });
        expect(datos.cuentas.idioma.castellano).toEqual({ eps: 1, pelis: 0, series: 0 });
        // Verlo otra vez entero en castellano: ahora sí, la serie en castellano (y la de VOSE, no).
        verEps(g, 1, "bb", "Breaking Bad", todos(BB).slice(0, 4), "es", "no");
        expect(ids(await calcular(g)).filter((id) => id.startsWith("plext:idioma"))).toEqual(["plext:idioma:bb:castellano"]);
    });

    test("en latino no cuenta como castellano; lo que no tiene idioma todavía, tampoco cuenta", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        serie(g, "s", "Serie", { 1: [1, 2] });
        verEps(g, 1, "s", "Serie", [[1, 1]], "lat", "no");
        verEps(g, 1, "s", "Serie", [[1, 2]], null, null, { revisado: 0 });
        await calcular(g);
        const datos = plexTrofeos.datosUsuario(g, "1", plexTrofeos.contexto(g));
        expect(Object.values(datos.cuentas.idioma).every((c) => c.eps === 0)).toBe(true);
    });

    test("anime: cada versión aparte, y no cuenta en las de series", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        const T = { 1: rango(1, 12) };
        const versiones = [
            ["a1", "es", "no", "anime_castellano", "plex_anime_es_eps_12"],
            ["a2", "ja", "es", "anime_jap_sub_es", "plex_anime_jpes_eps_12"],
            ["a3", "en", "no", "anime_ingles", "plex_anime_en_eps_12"],
            ["a4", "ja", "en", "anime_jap_sub_en", "plex_anime_jpen_eps_12"],
            ["a5", "ja", "no", "anime_jap_sin_subs", "plex_anime_jp_puro_eps_12"],
        ];
        for (const [k, audio, subs] of versiones) {
            serie(g, k, `Anime ${k}`, T, true);
            verEps(g, 1, k, `Anime ${k}`, todos(T), audio, subs);
        }
        const d = ids(await calcular(g));
        for (const [k, , , modo, logro] of versiones) {
            expect(d).toContain(`plext:idioma:${k}:${modo}`);
            expect(d).toContain(logro);
        }
        expect(d).toEqual(
            expect.arrayContaining([
                "plex_anime_es_series_1",
                "plex_anime_jpes_series_1",
                "plex_anime_en_series_1",
                "plex_anime_jpen_series_1",
                "plex_anime_jp_puro_series_1",
            ]),
        );
        expect(d.some((id) => /^plex_(en|vose|es)_/.test(id))).toBe(false);
        expect(achievements.getCatalog(g).find((a) => a.id === "plext:idioma:a2:anime_jap_sub_es")).toMatchObject({
            name: "Anime a2 en japonés con subtítulos en castellano",
            desc: "🎌 🇯🇵 Termina Anime a2 entera en japonés con subtítulos en castellano (12 episodios)",
            anime: true,
            emoji: "🎌",
        });
    });

    test("películas: una vez por versión aunque se vea dos veces; en dos idiomas, en los dos; las de anime aparte", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        for (let i = 0; i < 5; i++) {
            peli(g, `p${i}`, `Peli ${i}`);
            verPeli(g, 1, `p${i}`, `Peli ${i}`, "en", "es");
        }
        verPeli(g, 1, "p0", "Peli 0", "en", "es"); // repetida
        verPeli(g, 1, "p1", "Peli 1", "es", "no"); // y en castellano
        verPeli(g, 1, "sinficha", "Sin ficha", "en", "no"); // sin ficha: cuenta como película normal
        for (let i = 0; i < 3; i++) {
            peli(g, `ghibli${i}`, `Ghibli ${i}`, true);
            verPeli(g, 1, `ghibli${i}`, `Ghibli ${i}`, "ja", "es");
        }
        const d = ids(await calcular(g));
        expect(d).toEqual(expect.arrayContaining(["plex_en_pelis_5", "plex_vose_pelis_5", "plex_anime_jpes_pelis_3"]));
        const c = plexTrofeos.datosUsuario(g, "1", plexTrofeos.contexto(g)).cuentas.idioma;
        expect([c.ingles.pelis, c.vose.pelis, c.castellano.pelis, c.ingles_sin_subs.pelis, c.anime_jap_sub_es.pelis]).toEqual([
            6, 5, 1, 1, 3,
        ]);
    });

    test("una serie larga en un idioma es Gordo del Plex", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        const T = { 1: rango(1, 50), 2: rango(1, 50) };
        serie(g, "larga", "Larga", T);
        verEps(g, 1, "larga", "Larga", todos(T), "es", "no");
        await calcular(g);
        expect(achievements.getCatalog(g).find((a) => a.id === "plext:idioma:larga:castellano")).toMatchObject({
            dificultad: "gordo",
            rewardCoins: 1800,
        });
        expect(achievements.getCatalog(g).find((a) => a.id === "plext:serie:larga")).toMatchObject({ dificultad: "gordo" });
    });
});

describe("dificultad de los trofeos automáticos y en las pantallas", () => {
    test("cada tipo con la suya; las guardadas antes de las dificultades, por su tipo", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        serie(g, "s", "S", { 1: [1, 2], 2: [1, 2] });
        verEps(g, 1, "s", "S", todos({ 1: [1, 2], 2: [1, 2] }), null, null);
        await calcular(g);
        const cat = new Map(achievements.getCatalog(g).map((a) => [a.id, a]));
        expect(cat.get("plext:temporada:s:1").dificultad).toBe("facil");
        expect(cat.get("plext:serie:s").dificultad).toBe("normal");
        // Trofeos de antes de la migración 016 (sin dificultad).
        const viejo = (id, tipo) =>
            db
                .prepare("INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, creado) VALUES (?, ?, ?, 'x', 'x', 1)")
                .run(g, id, tipo);
        viejo("temporada:v:1", "temporada");
        viejo("genero:terror:10", "genero");
        viejo("genero:terror:25", "genero");
        viejo("saga:vieja", "saga");
        plexTrofeos.borrar(g, "no-existe"); // vacía la caché
        const cat2 = new Map(achievements.getCatalog(g).map((a) => [a.id, a]));
        expect(
            ["temporada:v:1", "genero:terror:10", "genero:terror:25", "saga:vieja"].map((id) => cat2.get(`plext:${id}`).dificultad),
        ).toEqual(["facil", "facil", "normal", "normal"]);
        // Fáciles: las 2 temporadas de S, la vieja y el género de 10; normales: la serie S, el género de 25 y la saga.
        expect(plexTrofeos.resumen(g).porDificultad).toEqual({ facil: 4, normal: 3, gordo: 0 });
    });

    test("en el perfil: junto a la categoría y, dentro de 🍿 Plex, cuántos tienes de cada dificultad", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        verPeli(g, 1, "x", "X", null, null);
        await calcular(g);
        const e = perfilPanel.buildLogros(g, "disc-1", "disc-1").embeds[0].data;
        expect(e.description).toMatch(/\*\*Se apagan las luces\*\* \(plex · 🟢 Fácil\)/);
        // Fuera de 🍿 Plex (todos o una categoría que no es Plex), sin recuento.
        expect(e.fields.some((f) => f.name === "🍿 Plex por dificultad")).toBe(false);
        const casino = perfilPanel.buildLogros(g, "disc-1", "disc-1", 0, false, "cat-casino").embeds[0].data;
        expect(casino.fields.some((f) => f.name === "🍿 Plex por dificultad")).toBe(false);
        // Dentro: de cada dificultad, los que tiene de los que hay (los secretos sin conseguir no cuentan).
        const hay = (d) => achievements.CATALOG.filter((a) => a.category === "plex" && a.dificultad === d && !a.hidden).length;
        const recuento = `🟢 Fácil: **1**/${hay("facil")} · 🟡 Normal: **0**/${hay("normal")} · 🎰 Gordo del Plex: **0**/${hay("gordo")}`;
        for (const filtro of ["cat-plex", "trofeos", "dif-facil", "dif-gordo"]) {
            const p = perfilPanel.buildLogros(g, "disc-1", "disc-1", 0, false, filtro).embeds[0].data;
            expect(p.fields.find((f) => f.name === "🍿 Plex por dificultad").value).toBe(recuento);
        }
        // Con los secretos a la vista, el recuento es el mismo.
        const conSecretos = perfilPanel.buildLogros(g, "disc-1", "disc-1", 0, true, "cat-plex").embeds[0].data;
        expect(conSecretos.fields.find((f) => f.name === "🍿 Plex por dificultad").value).toBe(recuento);
        // Los logros que no son de Plex, sin dificultad; y quien no tiene ninguno de Plex, sin recuento.
        await achievements.applyEvents(g, "disc-2", [{ event: "message_count", value: 1 }]);
        const otro = perfilPanel.buildLogros(g, "disc-2", "disc-2").embeds[0].data;
        expect(otro.description).toMatch(/\*\*Hola Mundo\*\* \(social\)/);
        const otroPlex = perfilPanel.buildLogros(g, "disc-2", "disc-2", 0, false, "cat-plex").embeds[0].data;
        expect(otroPlex.fields.some((f) => f.name === "🍿 Plex por dificultad")).toBe(false);
    });

    test("el anuncio lleva la dificultad; el Gordo del Plex, con 🎰", async () => {
        const g = nuevoGuild();
        const canal = { name: "c", isTextBased: () => true, send: jest.fn(async () => {}) };
        const guild = { id: g, name: g, channels: { cache: new Map([["c", canal]]), fetch: async () => null } };
        require("../src/systems/guildSettings").setSetting(g, "logros.notify_channel_id", "c");
        plexLinks.setLink(g, "disc-1", "1", "uno");
        for (let i = 0; i < 100; i++) verPeli(g, 1, `p${i}`, `P${i}`, null, null);
        await plexHistorial.actualizarLogros(guild);
        const texto = canal.send.mock.calls[0][0].content;
        expect(texto).toMatch(/🏅 \*\*Filmoteca andante\*\* — 🎰 Gordo del Plex/);
        expect(texto).toMatch(/🏅 \*\*Socio del videoclub\*\* — 🟡 Normal/);
    });
});

describe("trofeos de admin: dificultad y condiciones de idioma", () => {
    let g;
    beforeAll(() => {
        g = nuevoGuild();
        plexLinks.setLink(g, "disc-1", "1", "uno");
        serie(g, "bb", "Breaking Bad", { 1: [1, 2] });
        verEps(
            g,
            1,
            "bb",
            "Breaking Bad",
            [
                [1, 1],
                [1, 2],
            ],
            "en",
            "es",
        );
        serie(g, "fr", "Frieren", { 1: [1, 2, 3] }, true);
        verEps(
            g,
            1,
            "fr",
            "Frieren",
            [
                [1, 1],
                [1, 2],
                [1, 3],
            ],
            "ja",
            "en",
        );
        peli(g, "m", "Peli");
        verPeli(g, 1, "m", "Peli", "es", "no");
    });

    test.each([
        ["idioma-episodios:vose 2", 2, 2, "Ve 2 episodios en VOSE (inglés con subtítulos en castellano)"],
        ["idioma-episodios:ingles 5", 2, 5, "Ve 5 episodios en inglés"],
        ["idioma-peliculas:castellano 1", 1, 1, "Ve 1 películas en castellano"],
        ["idioma-series:ingles 1", 1, 1, "Termina 1 series enteras en inglés"],
        ["idioma-series:anime-jap-sub-en 1", 1, 1, "Termina 1 series de anime enteras en japonés con subtítulos en inglés"],
        ["idioma-episodios:anime_jap_sub_es 1", 0, 1, "Ve 1 episodios de anime en japonés con subtítulos en castellano"],
    ])("%s → progreso %i de %i", async (condicion, progreso, objetivo, desc) => {
        const r = plexTrofeos.crearAdmin(g, { nombre: condicion, condicion, recompensa: "10" }, "admin");
        expect(r.ok).toBe(true);
        expect(r.trofeo.descripcion).toBe(desc);
        await plexHistorial.actualizarLogros(g);
        expect(achievements.listUserAchievements(g, "disc-1").find((a) => a.id === `plext:${r.trofeo.id}`)).toMatchObject({
            progress: progreso,
            target: objetivo,
        });
        plexTrofeos.borrar(g, r.trofeo.id);
    });

    test("condiciones de idioma mal escritas", () => {
        const p = plexTrofeos.parsearCondicion;
        expect(p("idioma-episodios:klingon 5").error).toMatch(/^No conozco la versión "klingon"\. Hay: `ingles`, `vose`/);
        expect(p("idioma-episodios 5").error).toMatch(/^Falta el valor/);
        expect(p("idioma-series:vose").error).toMatch(/^Falta cuántos/);
        expect(p("idioma-peliculas:INGLÉS 3")).toMatchObject({ ok: true, texto: "idioma-peliculas:ingles 3" });
    });

    test("dificultad al crear: por defecto normal; fácil y gordo; otra cosa no", () => {
        const crear = (dificultad) =>
            plexTrofeos.crearAdmin(g, { nombre: "X", condicion: "peliculas 1", recompensa: "1", dificultad }, "admin");
        expect(crear(undefined).trofeo.dificultad).toBe("normal");
        expect(crear("fácil").trofeo.dificultad).toBe("facil");
        expect(crear("Gordo del Plex").trofeo.dificultad).toBe("gordo");
        expect(crear("imposible")).toEqual({ ok: false, error: "La dificultad tiene que ser fácil, normal o gordo (el Gordo del Plex)." });
        const cat = achievements.getCatalog(g).filter((a) => a.trofeo === "admin");
        expect(cat.map((a) => a.dificultad).sort()).toEqual(["facil", "gordo", "normal"]);
    });

    test("desde el formulario del panel, con la dificultad; y en la pantalla con su emoji y el recuento", async () => {
        const campos = {
            nombre: "Políglota",
            condicion: "idioma-episodios:vose 2",
            recompensa: "2000",
            descripcion: "",
            dificultad: "gordo",
        };
        const reply = jest.fn(async () => {});
        await handlePlexModal({
            customId: "paneladmin_plex_trofeo_modal",
            guildId: g,
            guild: { id: g },
            user: { id: "admin" },
            fields: { getTextInputValue: (k) => campos[k] },
            reply,
        });
        expect(reply.mock.calls[0][0].content).toMatch(/^✅ Trofeo \*\*Políglota\*\* creado .* · 🎰 Gordo del Plex\./);
        const mal = jest.fn(async () => {});
        await handlePlexModal({
            customId: "paneladmin_plex_trofeo_modal",
            guildId: g,
            guild: { id: g },
            user: { id: "admin" },
            fields: { getTextInputValue: (k) => ({ ...campos, dificultad: "muy" })[k] },
            reply: mal,
        });
        expect(mal.mock.calls[0][0].content).toMatch(/^❌ La dificultad/);
        const d = buildPlexTrofeos(g).embeds[0].data.description;
        expect(d).toMatch(/• 🎰 \*\*Políglota\*\* — `idioma-episodios:vose 2`/);
        expect(d).toMatch(/\*\*Por dificultad\*\*: 🟢 Fácil \*\*\d+\*\* · 🟡 Normal \*\*\d+\*\* · 🎰 Gordo del Plex \*\*\d+\*\*/);
        expect(d).toMatch(/🗣️ Idiomas: \*\*\d+\*\* reproducciones revisadas · \*\*0\*\* pendientes/);
        expect(d).toMatch(/`idioma-episodios:ingles 50`/);
        expect(d).toMatch(/🗣️ por idioma \*\*\d+\*\*/);
    });
});
