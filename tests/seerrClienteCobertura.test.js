// Cliente de Seerr (#239): configuración, errores de la API, búsqueda y recomendaciones, usuarios con su caché,
// peticiones con sus títulos, caché de búsquedas por canal y canales permitidos. Las llamadas HTTP están
// simuladas con un spy sobre axios.request: no sale nada a la red.
const axios = require("axios");
const guildSettings = require("../src/systems/guildSettings");
const seerr = require("../src/services/seerrClient");

const G = "g-seerr-cobertura";
let peticion;

function respuesta(status, data) {
    return { status, data };
}

// Devuelve lo que axios recibiría para cada ruta, según una tabla de respuestas. La coincidencia es exacta:
// «get /user» no debe responder a «get /user/1».
function conRespuestas(tabla) {
    peticion.mockImplementation(async (opciones) => {
        const clave = `${opciones.method} ${opciones.url.replace(/^.*\/api\/v1/, "")}`;
        const r = tabla[clave];
        if (!r) return respuesta(404, { message: `sin mock para ${clave}` });
        return typeof r === "function" ? r(opciones) : r;
    });
}

beforeEach(() => {
    peticion = jest.spyOn(axios, "request");
    jest.spyOn(guildSettings, "getSettings").mockReturnValue({
        seerr: { url: "https://seerr.local/", api_key: "clave-de-prueba", daily_request_limit: 3 },
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("configuración", () => {
    test("usa la del servidor y quita las barras finales de la URL", () => {
        expect(seerr.getConfig(G)).toEqual({ url: "https://seerr.local", apiKey: "clave-de-prueba", dailyRequestLimit: 3 });
    });

    test("sin ajustes del servidor cae a las variables de entorno", () => {
        jest.spyOn(guildSettings, "getSettings").mockReturnValue({ seerr: {} });
        process.env.SEERR_URL = "https://env.local//";
        process.env.SEERR_API_KEY = "clave-env";
        try {
            const cfg = seerr.getConfig(G);
            expect(cfg.url).toBe("https://env.local");
            expect(cfg.apiKey).toBe("clave-env");
            expect(cfg.dailyRequestLimit).toBe(5);
        } finally {
            delete process.env.SEERR_URL;
            delete process.env.SEERR_API_KEY;
        }
    });

    test("sin servidor no hay configuración", () => {
        expect(seerr.getConfig(null)).toEqual({ url: "", apiKey: "", dailyRequestLimit: 5 });
    });

    test("sin URL o sin clave, cualquier llamada falla antes de salir", async () => {
        jest.spyOn(guildSettings, "getSettings").mockReturnValue({ seerr: { url: "", api_key: "" } });
        await expect(seerr.searchMulti(G, "dune")).rejects.toThrow("Seerr no está configurado");
        expect(peticion).not.toHaveBeenCalled();
    });
});

describe("errores de la API", () => {
    test("un error HTTP lanza con el estado y el mensaje de Seerr", async () => {
        conRespuestas({ "get /search": respuesta(401, { message: "Clave no válida" }) });
        const err = await seerr.searchMulti(G, "dune").catch((e) => e);
        expect(err.status).toBe(401);
        expect(err.seerrMessage).toBe("Clave no válida");
        expect(err.message).toContain("get /search");
    });

    test("sin mensaje en el cuerpo usa el código HTTP", async () => {
        conRespuestas({ "get /search": respuesta(500, "") });
        const err = await seerr.searchMulti(G, "dune").catch((e) => e);
        expect(err.seerrMessage).toBe("HTTP 500");
    });

    test("un fallo de red se propaga tal cual", async () => {
        peticion.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
        await expect(seerr.searchMulti(G, "dune")).rejects.toThrow("ECONNREFUSED");
    });

    test("los parámetros se envían con %20 y no con «+»", async () => {
        conRespuestas({ "get /search": respuesta(200, { results: [] }) });
        await seerr.searchMulti(G, "Barbie 2");
        const { paramsSerializer, params } = peticion.mock.calls[0][0];
        expect(paramsSerializer(params)).toContain("query=Barbie%202");
        expect(paramsSerializer({ a: undefined, b: null, c: "x" })).toBe("c=x");
    });
});

describe("búsqueda", () => {
    test("texto vacío o solo símbolos no llama a Seerr", async () => {
        expect(await seerr.searchMulti(G, "   ")).toEqual([]);
        expect(await seerr.searchMulti(G, "¿¡!!")).toEqual([]);
        expect(peticion).not.toHaveBeenCalled();
    });

    test("quita los caracteres que TMDB rechaza y pide en español", async () => {
        conRespuestas({ "get /search": respuesta(200, { results: [] }) });
        await seerr.searchMulti(G, "Tom & Jerry: la película");
        expect(peticion.mock.calls[0][0].params).toEqual({ query: "Tom Jerry la película", page: 1, language: "es" });
    });

    test("devuelve solo películas y series con su forma, y recorta la sinopsis", async () => {
        conRespuestas({
            "get /search": respuesta(200, {
                results: [
                    {
                        id: 1,
                        mediaType: "movie",
                        title: "Dune",
                        releaseDate: "2021-09-15",
                        overview: "x".repeat(500),
                        mediaInfo: { status: 5 },
                    },
                    { id: 2, mediaType: "tv", name: "Severance", firstAirDate: "2022-02-18", mediaInfo: { status: 3 } },
                    { id: 3, mediaType: "person", name: "Alguien" },
                ],
            }),
        });
        const items = await seerr.searchMulti(G, "dune");
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            tmdbId: 1,
            mediaType: "movie",
            titulo: "Dune",
            anyo: "2021",
            sinopsis: "x".repeat(400),
            estado: "disponible",
            estadoCodigo: 5,
        });
        expect(items[1]).toMatchObject({ titulo: "Severance", anyo: "2022", estado: "procesando (descargando)" });
    });

    test("un resultado sin fechas, sinopsis ni estado tiene valores por defecto", async () => {
        conRespuestas({ "get /search": respuesta(200, { results: [{ id: 9, mediaType: "movie", title: "Sin datos" }] }) });
        const [item] = await seerr.searchMulti(G, "sin datos");
        // Sin mediaInfo, el texto del estado sale «desconocido» aunque el código por defecto sea 1 (sin solicitar).
        // Es una incoherencia menor de seerrClient.js que se deja anotada, no se cambia aquí.
        expect(item).toMatchObject({ anyo: null, sinopsis: null, estado: "desconocido", estadoCodigo: 1 });
    });

    test("un estado que no conoce se muestra como desconocido", async () => {
        conRespuestas({
            "get /search": respuesta(200, { results: [{ id: 9, mediaType: "movie", title: "X", mediaInfo: { status: 42 } }] }),
        });
        const [item] = await seerr.searchMulti(G, "x");
        expect(item.estado).toBe("desconocido");
    });

    test("una respuesta sin resultados devuelve lista vacía", async () => {
        conRespuestas({ "get /search": respuesta(200, {}) });
        expect(await seerr.searchMulti(G, "nada")).toEqual([]);
    });
});

describe("recomendaciones y títulos", () => {
    test("recomendaciones de una serie con su forma de búsqueda", async () => {
        conRespuestas({
            "get /tv/7/recommendations": respuesta(200, {
                results: [
                    { id: 11, mediaType: "tv", name: "Silo", firstAirDate: "2023-05-05", mediaInfo: { status: 2 } },
                    { id: 12, mediaType: "collection", name: "Descartada" },
                ],
            }),
        });
        const lista = await seerr.recomendaciones(G, "tv", "7");
        expect(lista).toEqual([{ tmdbId: 11, mediaType: "tv", titulo: "Silo", anyo: "2023", estadoCodigo: 2 }]);
    });

    test("getMediaTitle devuelve el título de película o serie y null si falla", async () => {
        conRespuestas({
            "get /movie/3": respuesta(200, { title: "Alien" }),
            "get /tv/4": respuesta(200, { name: "Fargo" }),
            "get /movie/5": respuesta(404, {}),
        });
        expect(await seerr.getMediaTitle(G, "movie", 3)).toBe("Alien");
        expect(await seerr.getMediaTitle(G, "tv", 4)).toBe("Fargo");
        expect(await seerr.getMediaTitle(G, "movie", 5)).toBeNull();
    });
});

describe("usuarios", () => {
    const usuarios = {
        "get /user": respuesta(200, { results: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
        "get /user/1": respuesta(200, {
            id: 1,
            plexUsername: "Ana",
            email: "ana@x.es",
            displayName: "Ana M.",
            settings: { discordIds: ["111"] },
        }),
        "get /user/2": respuesta(200, { id: 2, plexUsername: "bruno", settings: { discordIds: [] } }),
        "get /user/3": respuesta(500, {}),
    };

    test("lista los usuarios con sus ids de Discord y omite el que falla", async () => {
        conRespuestas(usuarios);
        const lista = await seerr.getUsersDetailed("g-usuarios-1");
        expect(lista.map((u) => u.id)).toEqual([1, 2]);
        expect(lista[0]).toMatchObject({ plexUsername: "Ana", discordIds: ["111"] });
        expect(lista[1].displayName).toBe("bruno");
    });

    test("la caché evita repetir las llamadas hasta que se fuerza", async () => {
        conRespuestas(usuarios);
        await seerr.getUsersDetailed("g-usuarios-2");
        const antes = peticion.mock.calls.length;
        await seerr.getUsersDetailed("g-usuarios-2");
        expect(peticion.mock.calls.length).toBe(antes);
        await seerr.getUsersDetailed("g-usuarios-2", { forceRefresh: true });
        expect(peticion.mock.calls.length).toBeGreaterThan(antes);
    });

    test("la caché caduca a los 10 minutos", async () => {
        conRespuestas(usuarios);
        const ahora = Date.now();
        const reloj = jest.spyOn(Date, "now").mockReturnValue(ahora);
        await seerr.getUsersDetailed("g-usuarios-3");
        const antes = peticion.mock.calls.length;
        reloj.mockReturnValue(ahora + 11 * 60 * 1000);
        await seerr.getUsersDetailed("g-usuarios-3");
        expect(peticion.mock.calls.length).toBeGreaterThan(antes);
    });

    test("resuelve la persona por su id de Discord o por su usuario de Plex, sin distinguir mayúsculas", async () => {
        conRespuestas(usuarios);
        expect((await seerr.resolveSeerrUserByDiscordId("g-usuarios-4", "111")).plexUsername).toBe("Ana");
        expect(await seerr.resolveSeerrUserByDiscordId("g-usuarios-4", "999")).toBeNull();
        expect((await seerr.resolveSeerrUserByPlexUsername("g-usuarios-4", "ANA")).id).toBe(1);
        expect(await seerr.resolveSeerrUserByPlexUsername("g-usuarios-4", "")).toBeNull();
    });

    test("sin lista de usuarios no revienta", async () => {
        conRespuestas({ "get /user": respuesta(200, {}) });
        expect(await seerr.getUsersDetailed("g-usuarios-5", { forceRefresh: true })).toEqual([]);
    });
});

describe("peticiones", () => {
    test("crear una película manda el id de TMDB sin temporadas", async () => {
        conRespuestas({ "post /request": respuesta(201, { id: 77 }) });
        const res = await seerr.createRequest(G, { mediaType: "movie", tmdbId: "603", userId: 4 });
        expect(res).toEqual({ id: 77 });
        expect(peticion.mock.calls[0][0].data).toEqual({ mediaType: "movie", mediaId: 603, is4k: false, userId: 4 });
    });

    test("crear una serie pide todas las temporadas si no se dice cuáles", async () => {
        conRespuestas({ "post /request": respuesta(201, { id: 78 }) });
        await seerr.createRequest(G, { mediaType: "tv", tmdbId: 1399 });
        expect(peticion.mock.calls[0][0].data).toEqual({ mediaType: "tv", mediaId: 1399, is4k: false, seasons: "all" });
    });

    test("la lista con títulos pone el id de TMDB si no se encuentra el nombre", async () => {
        conRespuestas({
            "get /request": respuesta(200, {
                results: [
                    {
                        id: 1,
                        type: "movie",
                        media: { tmdbId: 10, status: 5 },
                        requestedBy: { displayName: "Carla" },
                        createdAt: "2026-10-01T10:00:00Z",
                    },
                    { id: 2, type: "tv", media: { tmdbId: 20, status: 2 }, requestedBy: null, createdAt: null },
                ],
            }),
            "get /movie/10": respuesta(200, { title: "Heat" }),
            "get /tv/20": respuesta(500, {}),
        });
        const lista = await seerr.getRequests(G);
        expect(lista[0]).toEqual({ id: 1, estado: "disponible", tipo: "movie", titulo: "Heat", pedidoPor: "Carla", fecha: "2026-10-01" });
        expect(lista[1]).toEqual({
            id: 2,
            estado: "pendiente de aprobación",
            tipo: "tv",
            titulo: "(tmdb 20)",
            pedidoPor: "desconocido",
            fecha: null,
        });
    });

    test("getRequestsRaw devuelve los campos sin buscar títulos", async () => {
        conRespuestas({
            "get /request": respuesta(200, {
                results: [{ id: 5, type: "movie", media: { tmdbId: 8, status: "3" }, requestedBy: { id: 9, plexUsername: "dani" } }],
            }),
        });
        const lista = await seerr.getRequestsRaw(G, { filter: "pending" });
        expect(lista).toEqual([{ id: 5, mediaType: "movie", tmdbId: 8, estadoCodigo: 3, seerrUserId: 9, plexUsername: "dani" }]);
        expect(peticion).toHaveBeenCalledTimes(1);
    });

    test("testConnection dice si la conexión funciona y si no", async () => {
        conRespuestas({ "get /status": respuesta(200, { version: "2.5.0" }) });
        expect(await seerr.testConnection(G)).toEqual({ ok: true, version: "2.5.0" });

        peticion.mockRejectedValue(new Error("timeout"));
        expect(await seerr.testConnection(G)).toEqual({ ok: false, error: "timeout" });
    });
});

describe("caché de búsquedas por canal", () => {
    test("encuentra un resultado reciente del mismo tipo y no de otro", () => {
        seerr.cacheSearchResults("canal-cache-1", [{ tmdbId: 5, mediaType: "movie" }]);
        expect(seerr.getCachedSearchResult("canal-cache-1", 5, "movie")).toEqual({ tmdbId: 5, mediaType: "movie" });
        expect(seerr.getCachedSearchResult("canal-cache-1", 5, "tv")).toBeNull();
        expect(seerr.getCachedSearchResult("canal-sin-busqueda", 5, "movie")).toBeNull();
    });

    test("un resultado de hace más de 15 minutos ya no vale", () => {
        const ahora = Date.now();
        const reloj = jest.spyOn(Date, "now").mockReturnValue(ahora);
        seerr.cacheSearchResults("canal-cache-2", [{ tmdbId: 6, mediaType: "movie" }]);
        reloj.mockReturnValue(ahora + 16 * 60 * 1000);
        expect(seerr.getCachedSearchResult("canal-cache-2", 6, "movie")).toBeNull();
    });
});

describe("canales permitidos", () => {
    beforeEach(() => seerr.clearAllowedChannels(G));

    test("sin canales en la lista, cualquier canal vale", () => {
        expect(seerr.isChannelAllowed(G, "cualquiera")).toBe(true);
    });

    test("al añadir un canal la lista pasa a ser una lista blanca", () => {
        seerr.addAllowedChannel(G, "c-1", "peticiones");
        seerr.addAllowedChannel(G, "c-2", null);
        expect(seerr.isChannelAllowed(G, "c-1")).toBe(true);
        expect(seerr.isChannelAllowed(G, "c-3")).toBe(false);
        expect(
            seerr
                .getAllowedChannels(G)
                .map((c) => c.channelId)
                .sort(),
        ).toEqual(["c-1", "c-2"]);
    });

    test("añadir dos veces el mismo canal actualiza el nombre, no duplica", () => {
        seerr.addAllowedChannel(G, "c-1", "viejo");
        seerr.addAllowedChannel(G, "c-1", "nuevo");
        expect(seerr.getAllowedChannels(G)).toEqual([{ channelId: "c-1", channelName: "nuevo" }]);
    });

    test("quitar un canal y vaciar la lista", () => {
        seerr.addAllowedChannel(G, "c-1", "a");
        seerr.addAllowedChannel(G, "c-2", "b");
        seerr.removeAllowedChannel(G, "c-1");
        expect(seerr.getAllowedChannels(G).map((c) => c.channelId)).toEqual(["c-2"]);
        seerr.clearAllowedChannels(G);
        expect(seerr.isChannelAllowed(G, "c-3")).toBe(true);
    });
});
