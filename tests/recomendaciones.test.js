// 🎯 Recomendaciones personales (#22): las semillas (lo más visto de los últimos meses), lo que se descarta (ya visto y ya
// disponible), el orden (lo que recomiendan más semillas), los casos sin vincular o sin historial, el pedido en Seerr y
// el panel con su 📥 por título. Seerr se simula: no se hace ninguna petición real.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const seerrClient = require("../src/services/seerrClient");
const recomendaciones = require("../src/systems/recomendaciones");
const { pantallaRecomendaciones } = require("../src/paneles/recomendar");

const G = "g-recomendar";
const AHORA = Date.UTC(2026, 9, 8, 12);
const hace = (dias) => Math.floor((AHORA - dias * 86400000) / 1000);
let filaId = 5000;

function ver(user, { tipo = "episode", serie = null, titulo = "t", segundos = 3600, dias = 10 } = {}) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie, titulo, inicio, segundos, visto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(G, filaId++, String(user), tipo, `k${filaId}`, serie, titulo, hace(dias), segundos);
}

beforeAll(() => {
    plexLinks.setLink(G, "disc-ana", "1", "Ana");
});
beforeEach(() => {
    db.prepare("DELETE FROM plex_reproducciones WHERE guildId = ?").run(G);
});

const dependencias = (buscar, recomendar) => ({ buscar: jest.fn(buscar), recomendar: jest.fn(recomendar) });

describe("las semillas", () => {
    test("son lo más visto en los últimos meses, con las series agrupadas por serie", () => {
        ver("1", { serie: "Severance", titulo: "Ep 1", segundos: 2 * 3600 });
        ver("1", { serie: "Severance", titulo: "Ep 2", segundos: 2 * 3600 });
        ver("1", { tipo: "movie", titulo: "Dune", segundos: 3 * 3600 });
        ver("1", { tipo: "movie", titulo: "Vieja", segundos: 9 * 3600, dias: 400 }); // fuera de los últimos meses
        const s = recomendaciones.semillas(G, "1", { ahora: AHORA });
        expect(s).toEqual([
            { titulo: "Severance", tipo: "tv", segundos: 4 * 3600 },
            { titulo: "Dune", tipo: "movie", segundos: 3 * 3600 },
        ]);
    });
});

test("recomienda lo que recomiendan más semillas, y descarta lo ya visto y lo ya disponible", async () => {
    plexLinks.setLink(G, "disc-luis", "2", "Luis");
    ver("1", { tipo: "movie", titulo: "Dune", segundos: 3 * 3600 });
    ver("1", { serie: "Severance", titulo: "Ep 1", segundos: 2 * 3600 });
    ver("1", { tipo: "movie", titulo: "Blade Runner", segundos: 60 }); // visto: no se recomienda

    const deps = dependencias(
        async (_g, titulo) => ({ Dune: 1, Severance: 2 })[titulo] ?? null, // Blade Runner (la tercera semilla) no se encuentra en Seerr
        async (_g, tipo, tmdb) =>
            tmdb === 1
                ? [
                      { tmdbId: 10, mediaType: "movie", titulo: "Arrival", anyo: "2016", estadoCodigo: 1 },
                      { tmdbId: 20, mediaType: "tv", titulo: "Foundation", anyo: "2021", estadoCodigo: 1 },
                      { tmdbId: 40, mediaType: "movie", titulo: "Blade Runner", anyo: "1982", estadoCodigo: 1 },
                  ]
                : [
                      { tmdbId: 10, mediaType: "movie", titulo: "Arrival", anyo: "2016", estadoCodigo: 1 },
                      { tmdbId: 50, mediaType: "movie", titulo: "Ya en Plex", anyo: "2000", estadoCodigo: 5 },
                  ],
    );
    const r = await recomendaciones.generar(G, "disc-ana", deps, { ahora: AHORA });
    expect(r.ok).toBe(true);
    expect(r.sugerencias.map((s) => s.titulo)).toEqual(["Arrival", "Foundation"]);
    expect(r.sugerencias[0]).toMatchObject({ votos: 2, porque: ["Dune", "Severance"] });
    expect(deps.recomendar).toHaveBeenCalledWith(G, "movie", 1);
});

test("sin vincular a Plex, o sin historial, lo dice", async () => {
    const deps = dependencias(
        async () => 1,
        async () => [],
    );
    const sinVincular = await recomendaciones.generar(G, "disc-nadie", deps, { ahora: AHORA });
    expect(sinVincular).toMatchObject({ ok: false });
    expect(sinVincular.motivo).toMatch(/no está vinculada/);

    const sinHistorial = await recomendaciones.generar(G, "disc-ana", deps, { ahora: AHORA });
    expect(sinHistorial).toMatchObject({ ok: false });
    expect(sinHistorial.motivo).toMatch(/historial/);
});

test("pedir en Seerr lo hace a nombre de quien lo pide", async () => {
    const usuario = { id: 77 };
    jest.spyOn(seerrClient, "resolveSeerrUserByDiscordId").mockResolvedValue(usuario);
    const crear = jest.spyOn(seerrClient, "createRequest").mockResolvedValue({ id: 1 });
    const r = await recomendaciones.pedir(G, "disc-ana", "movie", 10);
    expect(r.ok).toBe(true);
    expect(crear).toHaveBeenCalledWith(G, { mediaType: "movie", tmdbId: 10, userId: 77 });
    jest.restoreAllMocks();
});

test("sin perfil de Seerr no se pide nada", async () => {
    jest.spyOn(seerrClient, "resolveSeerrUserByDiscordId").mockResolvedValue(null);
    const crear = jest.spyOn(seerrClient, "createRequest");
    const r = await recomendaciones.pedir(G, "disc-ana", "movie", 10);
    expect(r.ok).toBe(false);
    expect(crear).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test("el panel enseña cada sugerencia con su 📥", () => {
    const p = pantallaRecomendaciones({
        ok: true,
        sugerencias: [{ tmdbId: 10, mediaType: "movie", titulo: "Arrival", anyo: "2016", votos: 2, porque: ["Dune", "Severance"] }],
    });
    expect(p.embeds[0].data.description).toMatch(/\*\*Arrival\*\* \(2016\) · Película/);
    expect(p.components[0].components[0].data.custom_id).toBe("recomendar_pedir_movie_10");
    expect(pantallaRecomendaciones({ ok: false, motivo: "x", sugerencias: [] }).components).toEqual([]);
});
