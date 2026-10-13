// #465 y #466: seguir series (aviso por DM de los episodios nuevos, una vez por episodio, y sin parar si los DMs están
// cerrados) y la lista de «quiero ver» (aviso una sola vez cuando llega a Plex). Tautulli, Seerr y Discord se simulan.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const tautulliClient = require("../src/services/tautulliClient");
const seerrClient = require("../src/services/seerrClient");
const plexAvisos = require("../src/systems/plexAvisos");
const { pantallaSeries, pantallaQuieroVer } = require("../src/paneles/plexAvisos");

const G = "g-plex-avisos";
const ANA = "disc-ana-avisos";
const LUIS = "disc-luis-avisos";

/** Un cliente de Discord falso: guarda los DMs; los de `cerrados` fallan como con los DMs cerrados. */
function cliente(cerrados = []) {
    const dms = [];
    return {
        dms,
        guilds: { cache: new Map([[G, { id: G, name: "Servidor" }]]) },
        users: {
            fetch: async (id) => ({
                send: async (payload) => {
                    if (cerrados.includes(id)) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
                    dms.push({ id, content: payload.content });
                },
            }),
        },
    };
}

const episodio = (key, serieKey, serie, t, e, addedAt) => ({
    media_type: "episode",
    rating_key: key,
    grandparent_rating_key: serieKey,
    grandparent_title: serie,
    parent_media_index: t,
    media_index: e,
    title: `Episodio ${e}`,
    added_at: addedAt,
});

beforeAll(() => plexLinks.setLink(G, ANA, "501", "ana"));
beforeEach(() => {
    for (const t of ["plex_series_seguidas", "plex_avisos_series", "plex_quiero_ver", "plex_reproducciones"])
        db.prepare(`DELETE FROM ${t} WHERE guildId = ?`).run(G);
    jest.spyOn(tautulliClient, "getConfig").mockReturnValue({ url: "http://t", apiKey: "k" });
    jest.spyOn(seerrClient, "getConfig").mockReturnValue({ url: "http://s", apiKey: "k", dailyRequestLimit: 5 });
});
afterEach(() => jest.restoreAllMocks());

describe("📺 seguir series (#465)", () => {
    test("se sigue y se deja de seguir; no se repite ni pasa del máximo", () => {
        expect(plexAvisos.seguir(G, ANA, "100", "Severance").ok).toBe(true);
        expect(plexAvisos.seguir(G, ANA, "100", "Severance").ok).toBe(false);
        expect(plexAvisos.seguidas(G, ANA).map((s) => s.titulo)).toEqual(["Severance"]);
        expect(plexAvisos.dejarDeSeguir(G, ANA, "100")).toBe(true);
        expect(plexAvisos.seguidas(G, ANA)).toEqual([]);
        for (let i = 0; i < plexAvisos.MAX_SEGUIDAS; i++) plexAvisos.seguir(G, ANA, `s${i}`, `Serie ${i}`);
        expect(plexAvisos.seguir(G, ANA, "otra", "Otra").ok).toBe(false);
    });

    test("para elegir salen las series que ha visto y aún no sigue", () => {
        db.prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, serie, titulo, inicio, segundos, visto)
             VALUES (?, 1, '501', 'episode', 'e1', '100', 'Severance', 'x', 10, 100, 1), (?, 2, '501', 'episode', 'e2', '200', 'Andor', 'y', 20, 100, 1)`,
        ).run(G, G);
        expect(plexAvisos.seriesParaSeguir(G, ANA).map((s) => s.titulo)).toEqual(["Andor", "Severance"]);
        plexAvisos.seguir(G, ANA, "200", "Andor");
        expect(plexAvisos.seriesParaSeguir(G, ANA).map((s) => s.titulo)).toEqual(["Severance"]);
    });

    test("avisa por DM de un episodio nuevo una sola vez, y no de lo que entró antes de seguirla", async () => {
        plexAvisos.seguir(G, ANA, "100", "Severance");
        const desde = plexAvisos.seguidas(G, ANA)[0].creado_en;
        jest.spyOn(tautulliClient, "getRecentlyAdded").mockResolvedValue([
            episodio("e9", "100", "Severance", 2, 9, desde - 100), // ya estaba antes de seguirla
            episodio("e10", "100", "Severance", 2, 10, desde + 60),
            episodio("x1", "999", "Otra serie", 1, 1, desde + 60),
            { media_type: "movie", rating_key: "m1", title: "Peli", added_at: desde + 60 },
        ]);
        const c = cliente();
        expect(await plexAvisos.avisarSeries(c)).toBe(1);
        expect(c.dms).toHaveLength(1);
        expect(c.dms[0].content).toMatch(/Severance\*\* T2E10/);
        expect(c.dms[0].content).not.toMatch(/T2E9/);
        // La siguiente revisión ve lo mismo: no se repite.
        expect(await plexAvisos.avisarSeries(c)).toBe(0);
    });

    test("con los DMs cerrados, se apunta y sigue con los demás", async () => {
        plexAvisos.seguir(G, ANA, "100", "Severance");
        plexAvisos.seguir(G, LUIS, "100", "Severance");
        const desde = Math.max(...[ANA, LUIS].map((u) => plexAvisos.seguidas(G, u)[0].creado_en));
        jest.spyOn(tautulliClient, "getRecentlyAdded").mockResolvedValue([episodio("e10", "100", "Severance", 2, 10, desde + 60)]);
        const c = cliente([ANA]);
        await expect(plexAvisos.avisarSeries(c)).resolves.toBe(1);
        expect(c.dms.map((d) => d.id)).toEqual([LUIS]);
    });

    test("entiende las temporadas y series que Plex agrupa", () => {
        expect(
            plexAvisos.novedadDeSerie({
                media_type: "season",
                rating_key: "s2",
                parent_rating_key: "100",
                parent_title: "Severance",
                title: "Temporada 2",
                added_at: 5,
            }),
        ).toMatchObject({ serieKey: "100" });
        expect(plexAvisos.novedadDeSerie({ media_type: "show", rating_key: "100", title: "Severance", added_at: 5 })).toMatchObject({
            serieKey: "100",
        });
        expect(plexAvisos.novedadDeSerie({ media_type: "movie", rating_key: "m", title: "P", added_at: 5 })).toBeNull();
    });

    test("la pantalla tiene los menús de seguir y dejar de seguir", () => {
        plexAvisos.seguir(G, ANA, "100", "Severance");
        const ids = pantallaSeries(G, ANA).components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(ids).toEqual(expect.arrayContaining(["plex_sel_dejar", "plex_inicio"]));
    });
});

describe("📝 quiero ver (#466)", () => {
    const estado = (porTmdb) =>
        jest
            .spyOn(seerrClient, "getMediaStatus")
            .mockImplementation(async (g, tipo, id) => porTmdb[id] || { titulo: `T${id}`, estadoCodigo: 1 });

    test("se añade lo que aún no está en Plex; lo que ya está, no; y se puede quitar", async () => {
        estado({ 1: { titulo: "Dune 3", estadoCodigo: 1 }, 2: { titulo: "Matrix", estadoCodigo: 5 } });
        expect(await plexAvisos.anadirQuieroVer(G, ANA, "movie", 1)).toEqual({ ok: true, titulo: "Dune 3" });
        expect((await plexAvisos.anadirQuieroVer(G, ANA, "movie", 1)).ok).toBe(false);
        expect((await plexAvisos.anadirQuieroVer(G, ANA, "movie", 2)).motivo).toMatch(/ya está en Plex/);
        expect(plexAvisos.quieroVer(G, ANA).map((t) => t.titulo)).toEqual(["Dune 3"]);
        expect(plexAvisos.quitarQuieroVer(G, ANA, "movie", 1)).toBe(true);
        expect(plexAvisos.quieroVer(G, ANA)).toEqual([]);
    });

    test("cuando llega a Plex avisa una sola vez a cada uno y lo marca como disponible", async () => {
        const st = estado({ 1: { titulo: "Dune 3", estadoCodigo: 1 } });
        await plexAvisos.anadirQuieroVer(G, ANA, "movie", 1);
        await plexAvisos.anadirQuieroVer(G, LUIS, "movie", 1);
        const c = cliente();
        expect(await plexAvisos.avisarQuieroVer(c)).toBe(0);

        st.mockResolvedValue({ titulo: "Dune 3", estadoCodigo: 5 });
        expect(await plexAvisos.avisarQuieroVer(c)).toBe(2);
        expect(c.dms.map((d) => d.id).sort()).toEqual([ANA, LUIS].sort());
        expect(c.dms[0].content).toMatch(/Dune 3\*\* ya está en Plex/);
        expect(await plexAvisos.avisarQuieroVer(c)).toBe(0);
        expect(plexAvisos.quieroVer(G, ANA)[0].disponible_en).toBeGreaterThan(0);
    });

    test("una serie cuenta como llegada con episodios; una película a medias no", () => {
        expect(plexAvisos.haLlegado("tv", 4)).toBe(true);
        expect(plexAvisos.haLlegado("movie", 4)).toBe(false);
        expect(plexAvisos.haLlegado("movie", 5)).toBe(true);
    });

    test("la lista dice cuántos títulos tiene y marca los que ya han llegado", async () => {
        const st = estado({ 1: { titulo: "Dune 3", estadoCodigo: 1 }, 2: { titulo: "Andor", estadoCodigo: 1 } });
        await plexAvisos.anadirQuieroVer(G, ANA, "movie", 1);
        await plexAvisos.anadirQuieroVer(G, ANA, "tv", 2);
        st.mockImplementation(async (g, tipo, id) =>
            id === 2 ? { titulo: "Andor", estadoCodigo: 4 } : { titulo: "Dune 3", estadoCodigo: 1 },
        );
        await plexAvisos.avisarQuieroVer(cliente());
        const embed = pantallaQuieroVer(G, ANA).embeds[0].toJSON();
        expect(embed.footer.text).toBe(`2 de ${plexAvisos.MAX_QUIERO_VER} títulos · 1 ya en Plex`);
        expect(embed.description).toMatch(/✅ \*\*Andor\*\*/);
        expect(embed.description).toMatch(/⏳ \*\*Dune 3\*\*/);
    });
});

describe("los botones, menús y el formulario de /plex", () => {
    const plex = require("../src/commands/plex/plex");
    /** Una interacción falsa: guarda la última vista que se pintó (update, editReply o reply). */
    function interaccion(customId, extra = {}) {
        const i = {
            customId,
            guildId: G,
            user: { id: ANA },
            vista: null,
            modal: null,
            update: async (v) => (i.vista = v),
            editReply: async (v) => (i.vista = v),
            reply: async (v) => (i.vista = v),
            deferReply: async () => {},
            deferUpdate: async () => {},
            showModal: async (m) => (i.modal = m),
            ...extra,
        };
        return i;
    }
    const ids = (vista) => vista.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("el panel principal lleva a 📺 Series y 📝 Quiero ver, y se vuelve con ◀ Plex", async () => {
        const series = interaccion("plex_series");
        await plex.handleButton(null, series);
        expect(series.vista.embeds[0].toJSON().title).toBe("📺 Series que sigues");
        const quiero = interaccion("plex_quiero");
        await plex.handleButton(null, quiero);
        expect(quiero.vista.embeds[0].toJSON().title).toBe("📝 Quiero ver");
        const inicio = interaccion("plex_inicio");
        await plex.handleButton(null, inicio);
        expect(ids(inicio.vista)).toEqual(expect.arrayContaining(["plex_series", "plex_quiero", "plex_para_ti"]));
    });

    test("seguir y dejar de seguir desde los menús", async () => {
        db.prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, serie, titulo, inicio, segundos, visto)
             VALUES (?, 7, '501', 'episode', 'e7', '100', 'Severance', 'x', 10, 100, 1)`,
        ).run(G);
        const seguir = interaccion("plex_sel_seguir", { values: ["100"] });
        await plex.handleSelect(null, seguir);
        expect(seguir.vista.content).toMatch(/Sigues \*\*Severance\*\*/);
        expect(ids(seguir.vista)).toContain("plex_sel_dejar");
        const dejar = interaccion("plex_sel_dejar", { values: ["100"] });
        await plex.handleSelect(null, dejar);
        expect(dejar.vista.content).toMatch(/Ya no sigues/);
        expect(plexAvisos.seguidas(G, ANA)).toEqual([]);
    });

    test("➕ Añadir abre el formulario; buscar enseña los resultados y elegir uno lo apunta", async () => {
        const boton = interaccion("plex_quiero_anadir");
        await plex.handleButton(null, boton);
        expect(boton.modal.toJSON().custom_id).toBe("plex_modal_quiero");

        jest.spyOn(seerrClient, "searchMulti").mockResolvedValue([
            { tmdbId: 438631, mediaType: "movie", titulo: "Dune", anyo: "2021", estadoCodigo: 1 },
        ]);
        const formulario = interaccion("plex_modal_quiero", { fields: { getTextInputValue: () => "Dune" } });
        await plex.handleModal(null, formulario);
        expect(ids(formulario.vista)).toContain("plex_sel_anadir");

        jest.spyOn(seerrClient, "getMediaStatus").mockResolvedValue({ titulo: "Dune", estadoCodigo: 1 });
        const elegir = interaccion("plex_sel_anadir", { values: ["movie_438631"] });
        await plex.handleSelect(null, elegir);
        expect(elegir.vista.content).toMatch(/Apuntada \*\*Dune\*\*/);
        expect(plexAvisos.quieroVer(G, ANA).map((t) => t.titulo)).toEqual(["Dune"]);

        const quitar = interaccion("plex_sel_quitar", { values: ["movie_438631"] });
        await plex.handleSelect(null, quitar);
        expect(plexAvisos.quieroVer(G, ANA)).toEqual([]);
    });

    test("➕ en 🎯 Para ti apunta la sugerencia en «quiero ver»", async () => {
        jest.spyOn(seerrClient, "getMediaStatus").mockResolvedValue({ titulo: "Arrival", estadoCodigo: 1 });
        const i = interaccion("recomendar_quiero_movie_329865");
        await plex.handleButton(null, i);
        expect(i.vista.content).toMatch(/Arrival\*\* apuntada/);
        expect(plexAvisos.quieroVer(G, ANA)).toHaveLength(1);
    });
});
