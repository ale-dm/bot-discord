// #475: cada herramienta del Duende recibe sus dependencias como último argumento, así que se prueba con dobles: sin base de datos
// ni sistemas reales. Sin ese argumento usa las reales (lo que hace el Duende en producción).
const { DUENDE_ECONOMIA_EXECUTORS: economia } = require("../src/services/duende/herramientas/economia");
const { DUENDE_SEERR_EXECUTORS: seerr } = require("../src/services/duende/herramientas/seerr");
const { DUENDE_CORE_EXECUTORS: core } = require("../src/services/duende/herramientas/core");
const { DUENDE_PLEX_EXECUTORS: plex } = require("../src/services/duende/herramientas/plex");

const ctx = { guildId: "g", userId: "u", channelId: "c" };

describe("economía", () => {
    const retos = { motivoNoContraDuende: jest.fn(() => null) };
    const prestamos = { motivoNoPrestar: jest.fn(() => null) };

    test("sin servidor no propone nada ni consulta al sistema", () => {
        expect(economia.ofrecer_prestamo({ cantidad: 100 }, { userId: "u" }, { prestamos })).toEqual({
            error: "Solo disponible en servidores.",
        });
        expect(prestamos.motivoNoPrestar).not.toHaveBeenCalled();
    });

    test("si el sistema da un motivo, se devuelve como error sin negritas", () => {
        prestamos.motivoNoPrestar.mockReturnValueOnce("**Ya** tienes un préstamo");
        expect(economia.ofrecer_prestamo({ cantidad: 100 }, ctx, { prestamos })).toEqual({ error: "Ya tienes un préstamo" });
    });

    test("el reto consulta al sistema con quien habla y la cantidad", () => {
        retos.motivoNoContraDuende.mockReturnValueOnce("No puedes");
        expect(economia.retar_piedra_papel_tijera({ cantidad: 50 }, ctx, { retos })).toEqual({ error: "No puedes" });
        expect(retos.motivoNoContraDuende).toHaveBeenCalledWith("u", 50);
    });

    test("la apuesta a un partido que no existe lista los próximos", () => {
        const doble = { buscarPartido: () => null, partidosParaRetar: () => [{ home_team: "A", away_team: "B", start_time: 0 }] };
        const r = economia.apostar_partido_con_duende({ equipo: "A", cantidad: 10 }, ctx, { retos: doble });
        expect(r.error).toMatch(/No encuentro ese partido/);
        expect(r.proximos_partidos).toHaveLength(1);
    });
});

describe("seerr", () => {
    const seerrClient = { searchMulti: jest.fn(), cacheSearchResults: jest.fn(), getRequests: jest.fn() };

    test("buscar sin resultados no cachea nada", async () => {
        seerrClient.searchMulti.mockResolvedValueOnce([]);
        expect(await seerr.buscar_contenido_seerr({ titulo: "Nada" }, ctx, { seerrClient })).toEqual({ encontrado: false, titulo: "Nada" });
        expect(seerrClient.cacheSearchResults).not.toHaveBeenCalled();
    });

    test("buscar guarda en la caché del canal los cinco primeros", async () => {
        seerrClient.searchMulti.mockResolvedValueOnce([1, 2, 3, 4, 5, 6]);
        const r = await seerr.buscar_contenido_seerr({ titulo: "Algo" }, ctx, { seerrClient });
        expect(r.resultados).toEqual([1, 2, 3, 4, 5]);
        expect(seerrClient.cacheSearchResults).toHaveBeenCalledWith("c", [1, 2, 3, 4, 5]);
    });

    test("las solicitudes recientes se acotan a 15", async () => {
        seerrClient.getRequests.mockResolvedValue([]);
        await seerr.consultar_solicitudes_seerr({ cantidad: 99 }, ctx, { seerrClient });
        expect(seerrClient.getRequests).toHaveBeenCalledWith("g", { take: 15 });
    });

    test("pedir sin el cupo diario no crea la petición", async () => {
        const doble = {
            seerrClient: { getCachedSearchResult: () => ({ titulo: "X", estadoCodigo: 1 }), createRequest: jest.fn() },
            seerrCupo: { comprobar: () => ({ ok: false }), gastar: jest.fn() },
        };
        const r = await seerr.solicitar_contenido_seerr({ tmdbId: 1, mediaType: "movie" }, ctx, doble);
        expect(r.error).toMatch(/Límite diario/);
        expect(doble.seerrClient.createRequest).not.toHaveBeenCalled();
    });
});

describe("núcleo", () => {
    const dinero = { cuenta: jest.fn(() => ({ efectivo: 10, banco: 20, total: 30 })) };
    const prestamos = { abierto: jest.fn(() => null) };

    test("el saldo sale del sistema inyectado", () => {
        expect(core.consultar_saldo({}, ctx, { dinero, prestamos })).toEqual({ efectivo: 10, banco: 20, total: 30 });
    });

    test("el saldo incluye el préstamo abierto", () => {
        prestamos.abierto.mockReturnValueOnce({ falta: 55, vence_en: Date.now(), estado: "deuda" });
        const r = core.consultar_saldo({}, ctx, { dinero, prestamos });
        expect(r.prestamo_del_duende).toMatchObject({ le_falta_devolver: 55, vencido_y_en_deuda: true });
    });

    test("el precio de TTCL sale de la dependencia", () => {
        expect(core.precio_ttcl({}, ctx, { getTtclPrecio: () => 42 })).toEqual({ precio_ttcl_en_coins: 42 });
    });

    test("la tienda se recorta a 15 objetos y cuenta el total", () => {
        const items = Array.from({ length: 20 }, (_, i) => ({ nombre: `o${i}`, precio: i, stock: null }));
        const r = core.consultar_tienda({ busqueda: " espada " }, ctx, { tienda: { itemsTienda: jest.fn(() => items) } });
        expect(r.a_la_venta).toHaveLength(15);
        expect(r.total).toBe(20);
    });

    test("el perfil de una persona no identificada se avisa", () => {
        const r = core.consultar_perfil_persona({ persona: "Fulano" }, { ...ctx, guild: {} }, { resolveNameToDiscordId: () => null });
        expect(r).toMatchObject({ encontrado: false });
    });
});

describe("plex", () => {
    test("sin persona vinculada se devuelve el error sin llamar a Tautulli", async () => {
        const tautulliClient = { getUserWatchTimeStats: jest.fn() };
        const d = { tautulliClient, resolverPersonaVinculada: jest.fn(async () => ({ error: "sin vincular" })) };
        expect(await plex.consultar_tiempo_visto({ persona: "x" }, ctx, d)).toEqual({ error: "sin vincular" });
        expect(tautulliClient.getUserWatchTimeStats).not.toHaveBeenCalled();
    });

    test("lo que se está viendo sale del cliente inyectado", async () => {
        const tautulliClient = { getActivity: jest.fn(async () => []) };
        await plex.consultar_viendo_ahora({}, ctx, { tautulliClient });
        expect(tautulliClient.getActivity).toHaveBeenCalledWith("g");
    });
});
