// 🍿 Trofeos de Plex de punta a punta contra un Tautulli de mentira por HTTP (el cliente real, con axios): los
// parámetros que se mandan y las respuestas con la forma de Tautulli (números como texto, data dentro de data, {} si no
// existe, result "error"), y el flujo entero historial → fichas → trofeos sin mocks.
const http = require("http");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const tautulli = require("../src/services/tautulliClient");
const plexHistorial = require("../src/systems/plexHistorial");
const plexFichas = require("../src/systems/plexFichas");
const achievements = require("../src/systems/achievementsSystem");

const G = "guild-http";
const CLAVE = "clave-tautulli-de-prueba";
const peticiones = [];
let caido = false;

const ok = (data) => ({ response: { result: "success", message: null, data } });
const PELIS = {
    101: { title: "Origen", year: "2010" },
    102: { title: "Interstellar", year: "2014" },
    103: { title: "Memento", year: "2000" },
};
function responder(q) {
    switch (q.cmd) {
        case "get_libraries":
            return ok([
                { section_id: "1", section_name: "Películas", section_type: "movie", count: "3", is_active: 1 },
                { section_id: "2", section_name: "Anime", section_type: "show", count: "1", parent_count: "1", child_count: "3" },
            ]);
        case "get_library_media_info": {
            const filas = Object.entries(PELIS).map(([k, p]) => ({
                section_id: 1,
                section_type: "movie",
                rating_key: k,
                media_type: "movie",
                ...p,
            }));
            const start = Number(q.start);
            return ok({ draw: 1, recordsTotal: "3", recordsFiltered: 3, data: filas.slice(start, start + Number(q.length)) });
        }
        case "get_metadata": {
            if (caido) return { response: { result: "error", message: "Unable to retrieve data", data: {} } };
            if (PELIS[q.rating_key])
                return ok({
                    media_type: "movie",
                    section_id: "1",
                    library_name: "Películas",
                    rating_key: q.rating_key,
                    ...PELIS[q.rating_key],
                    genres: ["Ciencia ficción", "Acción"],
                    directors: ["Christopher Nolan"],
                    collections: [],
                });
            if (q.rating_key === "900")
                return ok({
                    media_type: "show",
                    section_id: "2",
                    library_name: "Anime",
                    rating_key: "900",
                    title: "Frieren",
                    year: "2023",
                    genres: ["Animación"],
                    children_count: 3,
                });
            if (q.rating_key === "999") return { response: { result: "error", message: "Invalid rating_key", data: {} } };
            return ok({}); // Plex ya no lo tiene
        }
        case "get_children_metadata": {
            const hijos = {
                "900|show": [
                    { media_type: "season", rating_key: "901", media_index: "1", title: "Temporada 1" },
                    { media_type: "season", rating_key: "902", media_index: "2", title: "Temporada 2" },
                ],
                "901|season": [
                    { media_type: "episode", rating_key: "9011", media_index: "1" },
                    { media_type: "episode", rating_key: "9012", media_index: "2" },
                ],
                "902|season": [{ media_type: "episode", rating_key: "9021", media_index: "1" }],
            };
            const lista = hijos[`${q.rating_key}|${q.media_type}`] || [];
            return ok({ children_count: lista.length, children_type: "x", title: "x", children_list: lista });
        }
        case "get_history": {
            const base = Date.UTC(2026, 6, 1) / 1000;
            const filas = [
                ...["101", "102", "103"].map((k, i) => ({
                    row_id: 10 + i,
                    user_id: 5,
                    media_type: "movie",
                    rating_key: Number(k),
                    title: PELIS[k].title,
                    year: Number(PELIS[k].year),
                })),
                ...[
                    ["9011", 1, 1],
                    ["9012", 1, 2],
                    ["9021", 2, 1],
                ].map(([k, t, e], i) => ({
                    row_id: 20 + i,
                    user_id: 5,
                    media_type: "episode",
                    rating_key: Number(k),
                    grandparent_rating_key: 900,
                    grandparent_title: "Frieren",
                    parent_media_index: t,
                    media_index: e,
                    title: `Episodio ${e}`,
                })),
                // Uno de una serie que ya no está en Plex (Tautulli responde con error a su ficha).
                {
                    row_id: 30,
                    user_id: 5,
                    media_type: "episode",
                    rating_key: 9991,
                    grandparent_rating_key: 999,
                    grandparent_title: "Borrada",
                    parent_media_index: 1,
                    media_index: 1,
                },
            ].map((f, i) => ({ started: base + i * 3600, play_duration: 3000, percent_complete: 100, watched_status: 1, ...f }));
            return ok({ draw: 1, recordsTotal: filas.length, recordsFiltered: filas.length, data: Number(q.start) ? [] : filas });
        }
        default:
            return { response: { result: "error", message: `Invalid cmd ${q.cmd}`, data: {} } };
    }
}

let servidor;
const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
const guild = { id: G, name: G, channels: { cache: new Map([["canal-logros", canal]]), fetch: async () => null } };

beforeAll(async () => {
    delete process.env.GOOGLE_API_KEY; // nombres por defecto, sin Gemini
    servidor = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const q = Object.fromEntries(url.searchParams);
        peticiones.push(q);
        res.setHeader("Content-Type", "application/json");
        if (url.pathname !== "/api/v2" || q.apikey !== CLAVE) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ response: { result: "error", message: "Invalid apikey" } }));
        }
        if (q.cmd === "roto") {
            res.statusCode = 500;
            return res.end("Internal Server Error");
        }
        res.end(JSON.stringify(responder(q)));
    });
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    guildSettings.setSetting(G, "plex.tautulli_url", `http://127.0.0.1:${servidor.address().port}/`);
    guildSettings.setSetting(G, "plex.tautulli_api_key", CLAVE);
    guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
    plexLinks.setLink(G, "disc-5", "5", "frieren_fan");
});

afterAll(() => new Promise((r) => servidor.close(r)));

const ultima = (cmd) => [...peticiones].reverse().find((p) => p.cmd === cmd);

describe("cliente de Tautulli", () => {
    test("get_metadata: manda la clave y devuelve la ficha; null si Plex no la tiene o Tautulli da error", async () => {
        expect(await tautulli.getMetadata(G, "101")).toMatchObject({ title: "Origen", directors: ["Christopher Nolan"] });
        expect(ultima("get_metadata")).toMatchObject({ apikey: CLAVE, rating_key: "101" });
        expect(await tautulli.getMetadata(G, "555")).toBeNull();
        expect(await tautulli.getMetadata(G, "999")).toBeNull();
    });

    test("get_children_metadata: con media_type, devuelve la lista", async () => {
        const hijos = await tautulli.getChildrenMetadata(G, "900", "show");
        expect(hijos.map((h) => h.media_index)).toEqual(["1", "2"]);
        expect(ultima("get_children_metadata")).toMatchObject({ rating_key: "900", media_type: "show" });
    });

    test("get_library_media_info: por páginas, con el total", async () => {
        expect(await tautulli.getLibraryMediaInfo(G, "1", { start: 1, length: 1 })).toEqual({
            filas: [expect.objectContaining({ rating_key: "102", title: "Interstellar" })],
            total: 3,
        });
        expect(ultima("get_library_media_info")).toMatchObject({ section_id: "1", start: "1", length: "1" });
    });

    test("un error de Tautulli se marca como respuesta suya; un fallo HTTP, no", async () => {
        const malo = await tautulli.getUsers(G).catch((e) => e); // get_users no está en el falso: result "error"
        expect(malo.respuestaDeTautulli).toBe(true);
        guildSettings.setSetting(G, "plex.tautulli_api_key", "mala");
        const http401 = await tautulli.getMetadata(G, "101").catch((e) => e);
        expect(http401).toBeInstanceOf(Error);
        expect(http401.respuestaDeTautulli).toBeUndefined();
        guildSettings.setSetting(G, "plex.tautulli_api_key", CLAVE);
    });
});

describe("de punta a punta", () => {
    let resultado;
    beforeAll(async () => {
        ({ logros: resultado } = await plexHistorial.sincronizarYCalcular(guild, { presupuesto: 1000 }));
    });

    test("historial sin agrupar, fichas de la biblioteca y de las series vistas (la borrada, marcada)", () => {
        expect(ultima("get_history")).toMatchObject({ grouping: "0", order_column: "date", order_dir: "desc", start: "0", length: "1000" });
        expect(plexFichas.estado(G)).toMatchObject({ peliculas: 3, series: 1, pendientes: 0, perdidas: 1, completa: true });
        const frieren = plexFichas.cargar(G).series.find((s) => s.rating_key === "900");
        expect(frieren).toMatchObject({
            titulo: "Frieren",
            anio: 2023,
            section_id: "2",
            biblioteca: "Anime",
            temporadas: { 1: [1, 2], 2: [1] },
        });
    });

    test("trofeos: Frieren entera y sus temporadas (anime), todas las de Nolan, y los contadores de anime", () => {
        const ids = resultado[0].desbloqueados.map((a) => a.id).sort();
        expect(ids).toEqual(
            expect.arrayContaining([
                "plext:serie:900",
                "plext:temporada:900:1",
                "plext:temporada:900:2",
                "plext:director:christopher-nolan",
                "plex_anime_completas_1",
                "plex_pelis_1",
            ]),
        );
        expect(ids).not.toContain("plex_completas_1"); // Frieren es anime: no cuenta como serie
        const cat = new Map(achievements.getCatalog(G).map((a) => [a.id, a]));
        // Sin Gemini, los nombres por defecto.
        expect(cat.get("plext:serie:900")).toMatchObject({
            name: "Frieren: completada",
            anime: true,
            desc: "🎌 Termina Frieren entera (3 episodios)",
        });
        expect(cat.get("plext:director:christopher-nolan").name).toBe("Filmografía de Christopher Nolan");
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(canal.send.mock.calls[0][0].content).toMatch(
            /🏅 \*\*Frieren: completada\*\* — 🎌 Termina Frieren entera \(3 episodios\) · lo tiene el 100 % del servidor/,
        );
    });

    test("con Plex caído (Tautulli da error en todas las fichas), no se pierde nada", async () => {
        const db = require("../src/core/db");
        db.prepare("UPDATE plex_fichas SET actualizada = 1 WHERE guildId = ? AND tipo = 'movie'").run(G); // viejas: se refrescarían
        caido = true;
        const r = await plexFichas.actualizar(G, { presupuesto: 1000 });
        caido = false;
        expect(r).toMatchObject({ fichas: 0, errores: 1 });
        expect(plexFichas.estado(G)).toMatchObject({ peliculas: 3, perdidas: 1 });
    });
});
