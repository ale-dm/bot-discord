// Herramientas de Seerr del Duende (#239): búsqueda y caché por canal, peticiones (límite diario, persona en
// nombre de otra, errores de Seerr) y consulta de peticiones. El cliente de Seerr está simulado con spies: no sale
// nada a la red. Los vínculos de Plex y el límite diario son reales (base en memoria).
const mockPersonas = {
    Ana: "200000000000000001",
    Bruno: "200000000000000002",
    Carla: "200000000000000003",
};

jest.mock("../src/systems/duende/personas", () => {
    const real = jest.requireActual("../src/systems/duende/personas");
    return {
        ...real,
        resolveNameToDiscordId: jest.fn((nombre) => mockPersonas[nombre] || null),
    };
});

const plexLinks = require("../src/systems/plexLinks");
const seerrClient = require("../src/services/seerrClient");
const { DUENDE_SEERR_TOOL_DECLARATIONS, DUENDE_SEERR_EXECUTORS } = require("../src/services/duende/herramientas/seerr");

const G = "g-seerr-herramientas";
let canalN = 0;
let usuarioN = 0;

// Contexto de Discord de una petición. Cada test usa su propio canal y su propia persona, así el cupo diario
// (que vive en la BD en memoria) no se contamina entre tests.
function contexto(extra = {}) {
    return {
        guildId: G,
        channelId: `canal-${++canalN}`,
        guild: { id: G, members: { cache: new Map() } },
        userId: `300000000000000${String(++usuarioN).padStart(3, "0")}`,
        ...extra,
    };
}

const ejecutar = (nombre, args, ctx = contexto()) => DUENDE_SEERR_EXECUTORS[nombre](args, ctx);

let spies;

beforeAll(() => {
    plexLinks.setLink(G, mockPersonas.Bruno, "tau-bruno", "bruno_plex");
});

beforeEach(() => {
    spies = {
        searchMulti: jest.spyOn(seerrClient, "searchMulti").mockResolvedValue([]),
        createRequest: jest.spyOn(seerrClient, "createRequest").mockResolvedValue({ id: 1 }),
        getRequests: jest.spyOn(seerrClient, "getRequests").mockResolvedValue([]),
        getConfig: jest.spyOn(seerrClient, "getConfig").mockReturnValue({ url: "x", apiKey: "y", dailyRequestLimit: 3 }),
        porDiscord: jest.spyOn(seerrClient, "resolveSeerrUserByDiscordId").mockResolvedValue(null),
        porPlex: jest.spyOn(seerrClient, "resolveSeerrUserByPlexUsername").mockResolvedValue(null),
    };
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Deja una búsqueda reciente en el canal, como haría buscar_contenido_seerr antes de solicitar.
async function buscarEn(ctx, resultados) {
    spies.searchMulti.mockResolvedValueOnce(resultados);
    return ejecutar("buscar_contenido_seerr", { titulo: "lo que sea" }, ctx);
}

const MATRIX = { tmdbId: 603, mediaType: "movie", titulo: "Matrix", anyo: "1999", estadoCodigo: 1 };

describe("declaraciones para Gemini", () => {
    test("hay tres herramientas y cada una tiene ejecutor", () => {
        expect(DUENDE_SEERR_TOOL_DECLARATIONS.map((d) => d.name).sort()).toEqual([
            "buscar_contenido_seerr",
            "consultar_solicitudes_seerr",
            "solicitar_contenido_seerr",
        ]);
        for (const d of DUENDE_SEERR_TOOL_DECLARATIONS) expect(typeof DUENDE_SEERR_EXECUTORS[d.name]).toBe("function");
    });

    test("solicitar exige tmdbId y mediaType; buscar exige titulo", () => {
        const porNombre = Object.fromEntries(DUENDE_SEERR_TOOL_DECLARATIONS.map((d) => [d.name, d]));
        expect(porNombre.solicitar_contenido_seerr.parameters.required).toEqual(["tmdbId", "mediaType"]);
        expect(porNombre.buscar_contenido_seerr.parameters.required).toEqual(["titulo"]);
        expect(porNombre.consultar_solicitudes_seerr.parameters.required).toBeUndefined();
    });
});

describe("buscar_contenido_seerr", () => {
    test("fuera de un servidor no busca", async () => {
        const r = await ejecutar("buscar_contenido_seerr", { titulo: "Matrix" }, contexto({ guildId: null }));
        expect(r).toEqual({ error: "Solo disponible en servidores." });
        expect(spies.searchMulti).not.toHaveBeenCalled();
    });

    test("un título vacío o con solo espacios pide el título y no busca", async () => {
        expect(await ejecutar("buscar_contenido_seerr", { titulo: "   " })).toEqual({ error: "Falta el título a buscar." });
        expect(await ejecutar("buscar_contenido_seerr", {})).toEqual({ error: "Falta el título a buscar." });
        expect(spies.searchMulti).not.toHaveBeenCalled();
    });

    test("sin resultados lo dice con el título buscado, sin espacios sobrantes", async () => {
        const r = await ejecutar("buscar_contenido_seerr", { titulo: "  Zzzz  " });
        expect(r).toEqual({ encontrado: false, titulo: "Zzzz" });
        expect(spies.searchMulti).toHaveBeenCalledWith(G, "Zzzz");
    });

    test("con resultados devuelve los 5 primeros y los deja en caché para solicitar", async () => {
        const ctx = contexto();
        const muchos = Array.from({ length: 7 }, (_, i) => ({ ...MATRIX, tmdbId: 1000 + i }));
        const r = await buscarEn(ctx, muchos);
        expect(r.encontrado).toBe(true);
        expect(r.resultados).toHaveLength(5);
        expect(r.resultados.map((x) => x.tmdbId)).toEqual([1000, 1001, 1002, 1003, 1004]);
        // El sexto no está en caché: no se puede pedir.
        const pedido = await ejecutar("solicitar_contenido_seerr", { tmdbId: 1005, mediaType: "movie" }, ctx);
        expect(pedido.error).toContain("no viene de una búsqueda reciente");
    });
});

describe("solicitar_contenido_seerr: validación y caché", () => {
    test("fuera de un servidor no pide", async () => {
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, contexto({ guildId: null }));
        expect(r).toEqual({ error: "Solo disponible en servidores." });
        expect(spies.createRequest).not.toHaveBeenCalled();
    });

    test("tmdbId inválido, cero o tipo desconocido se rechaza sin tocar Seerr", async () => {
        const ctx = contexto();
        for (const args of [
            { tmdbId: "abc", mediaType: "movie" },
            { tmdbId: 0, mediaType: "movie" },
            { tmdbId: 603, mediaType: "person" },
            { tmdbId: 603 },
        ]) {
            expect(await ejecutar("solicitar_contenido_seerr", args, ctx)).toEqual({ error: "Faltan tmdbId/mediaType válidos." });
        }
        expect(spies.createRequest).not.toHaveBeenCalled();
    });

    test("el mediaType se acepta en mayúsculas", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porDiscord.mockResolvedValueOnce({ id: 11, displayName: "Ana" });
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: "603", mediaType: "MOVIE" }, ctx);
        expect(r.pedido).toBe(true);
        expect(spies.createRequest.mock.calls[0][1]).toEqual({ mediaType: "movie", tmdbId: 603, userId: 11 });
    });

    test("un tmdbId que no salió de una búsqueda del mismo canal se rechaza", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        const otroCanal = contexto({ guildId: G, userId: ctx.userId });
        // Mismo tmdbId, pero en otro canal: la caché es por canal.
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, otroCanal);
        expect(r.error).toContain("Llama primero a buscar_contenido_seerr");
        expect(spies.createRequest).not.toHaveBeenCalled();
    });

    test("si ya está disponible o ya solicitado, no vuelve a pedirlo", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [{ ...MATRIX, tmdbId: 1, titulo: "Ya está", estadoCodigo: 5 }]);
        expect(await ejecutar("solicitar_contenido_seerr", { tmdbId: 1, mediaType: "movie" }, ctx)).toEqual({
            ya_disponible: true,
            titulo: "Ya está",
        });

        for (const codigo of [2, 3, 4]) {
            await buscarEn(ctx, [{ ...MATRIX, tmdbId: 10 + codigo, titulo: `Estado ${codigo}`, estadoCodigo: codigo, estado: "x" }]);
            const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 10 + codigo, mediaType: "movie" }, ctx);
            expect(r).toEqual({ ya_solicitado: true, titulo: `Estado ${codigo}`, estado: "x" });
        }
        expect(spies.createRequest).not.toHaveBeenCalled();
    });
});

describe("solicitar_contenido_seerr: peticiones", () => {
    test("pide en nombre de quien habla y devuelve el título y el nombre de la cuenta de Seerr", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porDiscord.mockResolvedValueOnce({ id: 42, displayName: "Ana Seerr" });
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx);
        expect(r).toEqual({ pedido: true, titulo: "Matrix", pedido_por: "Ana Seerr" });
        expect(spies.porDiscord).toHaveBeenCalledWith(G, ctx.userId);
        expect(spies.createRequest).toHaveBeenCalledWith(G, { mediaType: "movie", tmdbId: 603, userId: 42 });
    });

    test("con persona, la petición va a nombre de esa persona", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porDiscord.mockResolvedValueOnce({ id: 9, displayName: "Bruno" });
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie", persona: "Bruno" }, ctx);
        expect(r.pedido).toBe(true);
        expect(spies.porDiscord).toHaveBeenCalledWith(G, mockPersonas.Bruno);
        expect(spies.createRequest.mock.calls[0][1].userId).toBe(9);
    });

    test("una persona que no se identifica en el servidor no pide nada", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie", persona: "Zeta" }, ctx);
        expect(r).toEqual({ error: 'No identifico a "Zeta" entre los miembros del server.' });
        expect(spies.createRequest).not.toHaveBeenCalled();
    });

    test("sin Discord guardado en Seerr, la persona se localiza por su vínculo de Plex", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porPlex.mockResolvedValueOnce({ id: 77, displayName: "Bruno Plex" });
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie", persona: "Bruno" }, ctx);
        expect(r).toEqual({ pedido: true, titulo: "Matrix", pedido_por: "Bruno Plex" });
        expect(spies.porPlex).toHaveBeenCalledWith(G, "bruno_plex");
        expect(spies.createRequest.mock.calls[0][1].userId).toBe(77);
    });

    test("una persona sin Discord vinculado en Seerr ni en Plex no pide, y el mensaje la nombra", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie", persona: "Carla" }, ctx);
        expect(r.error).toContain("Carla no tiene su Discord vinculado");
        expect(spies.createRequest).not.toHaveBeenCalled();
    });

    test("quien habla sin vínculo recibe el aviso genérico", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        const r = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx);
        expect(r.error).toMatch(/^Esta persona no tiene su Discord vinculado/);
    });

    test("si Seerr rechaza la petición, se devuelve su mensaje; sin mensaje, el del error", async () => {
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porDiscord.mockResolvedValueOnce({ id: 1, displayName: "Ana" });
        spies.createRequest.mockRejectedValueOnce(Object.assign(new Error("interno"), { seerrMessage: "Ya existe" }));
        expect(await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx)).toEqual({
            error: "No se pudo pedir: Ya existe",
        });

        spies.porDiscord.mockResolvedValueOnce({ id: 1, displayName: "Ana" });
        spies.createRequest.mockRejectedValueOnce(new Error("socket colgado"));
        expect(await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx)).toEqual({
            error: "No se pudo pedir: socket colgado",
        });
    });

    test("el límite diario corta la segunda petición de quien habla", async () => {
        spies.getConfig.mockReturnValue({ url: "x", apiKey: "y", dailyRequestLimit: 1 });
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX, { ...MATRIX, tmdbId: 604, titulo: "Reloaded" }]);
        spies.porDiscord.mockResolvedValue({ id: 5, displayName: "Ana" });

        expect((await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx)).pedido).toBe(true);
        const segunda = await ejecutar("solicitar_contenido_seerr", { tmdbId: 604, mediaType: "movie" }, ctx);
        expect(segunda).toEqual({ error: "Límite diario de peticiones de contenido alcanzado. Que lo pida mañana." });
        expect(spies.createRequest).toHaveBeenCalledTimes(1);
    });

    // El cupo se gasta solo cuando Seerr acepta la petición. Antes se gastaba antes de llamar a Seerr, así que
    // una petición que fallaba consumía el cupo del día (herramientas/seerr.js).
    test("una petición fallida no gasta el cupo diario", async () => {
        spies.getConfig.mockReturnValue({ url: "x", apiKey: "y", dailyRequestLimit: 1 });
        const ctx = contexto();
        await buscarEn(ctx, [MATRIX]);
        spies.porDiscord.mockResolvedValue({ id: 5, displayName: "Ana" });
        spies.createRequest.mockRejectedValueOnce(new Error("Seerr caído"));
        await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx);

        const reintento = await ejecutar("solicitar_contenido_seerr", { tmdbId: 603, mediaType: "movie" }, ctx);
        expect(reintento.pedido).toBe(true);
    });
});

describe("consultar_solicitudes_seerr", () => {
    test("fuera de un servidor no consulta", async () => {
        expect(await ejecutar("consultar_solicitudes_seerr", {}, contexto({ guildId: null }))).toEqual({
            error: "Solo disponible en servidores.",
        });
        expect(spies.getRequests).not.toHaveBeenCalled();
    });

    test("por defecto trae 5 peticiones y devuelve la lista tal cual", async () => {
        const lista = [{ id: 1, titulo: "Matrix", estado: "disponible" }];
        spies.getRequests.mockResolvedValueOnce(lista);
        expect(await ejecutar("consultar_solicitudes_seerr", {})).toEqual({ solicitudes: lista });
        expect(spies.getRequests).toHaveBeenCalledWith(G, { take: 5 });
    });

    test("la cantidad se acota entre 1 y 15 y acepta texto numérico", async () => {
        const casos = [
            [{ cantidad: 7 }, 7],
            [{ cantidad: "9" }, 9],
            [{ cantidad: 99 }, 15],
            [{ cantidad: -3 }, 1],
            [{ cantidad: 0.5 }, 1],
            [{ cantidad: 0 }, 5],
            [{ cantidad: "no es un número" }, 5],
        ];
        for (const [args, esperado] of casos) {
            spies.getRequests.mockClear();
            await ejecutar("consultar_solicitudes_seerr", args);
            expect(spies.getRequests).toHaveBeenCalledWith(G, { take: esperado });
        }
    });
});
