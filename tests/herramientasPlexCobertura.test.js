// Herramientas de Plex del Duende (#239): cada ejecutor que habla con Tautulli, con el cliente simulado (spy sobre sus
// métodos). Los vínculos de Plex son reales (base en memoria); el nombre de una persona se resuelve con una tabla
// de prueba en vez de con apodos y perfiles. Los trofeos tienen su propia prueba (plexDuendeTrofeos.test.js).
const mockPersonas = {
    Ana: "100000000000000001",
    Bruno: "100000000000000002",
    Carla: "100000000000000003",
};

jest.mock("../src/systems/duende/personas", () => {
    const real = jest.requireActual("../src/systems/duende/personas");
    return {
        ...real,
        resolveNameToDiscordId: jest.fn((nombre) => mockPersonas[nombre] || null),
    };
});

const plexLinks = require("../src/systems/plexLinks");
const tautulliClient = require("../src/services/tautulliClient");
const { DUENDE_PLEX_TOOL_DECLARATIONS, DUENDE_PLEX_EXECUTORS } = require("../src/services/duende/herramientas/plex");

const G = "g-plex-herramientas";
const ejecutar = (nombre, args, ctx = contexto()) => DUENDE_PLEX_EXECUTORS[nombre](args, ctx);

function contexto(extra = {}) {
    return {
        guildId: G,
        guild: { id: G, members: { cache: new Map() } },
        userId: "100000000000000009",
        ...extra,
    };
}

beforeAll(() => {
    plexLinks.setLink(G, mockPersonas.Ana, "tau-ana", "ana_plex");
    plexLinks.setLink(G, mockPersonas.Bruno, "tau-bruno", "bruno_plex");
    // Carla no tiene cuenta vinculada.
});

let spies;

beforeEach(() => {
    spies = {
        getHistory: jest.spyOn(tautulliClient, "getHistory").mockResolvedValue([]),
        getActivity: jest.spyOn(tautulliClient, "getActivity").mockResolvedValue([]),
        getUserWatchTimeStats: jest.spyOn(tautulliClient, "getUserWatchTimeStats").mockResolvedValue([]),
        getRecentlyAdded: jest.spyOn(tautulliClient, "getRecentlyAdded").mockResolvedValue([]),
        getHomeStats: jest.spyOn(tautulliClient, "getHomeStats").mockResolvedValue([]),
        search: jest.spyOn(tautulliClient, "search").mockResolvedValue({}),
        getPlaysByTopUsers: jest.spyOn(tautulliClient, "getPlaysByTopUsers").mockResolvedValue({}),
        getLibraries: jest.spyOn(tautulliClient, "getLibraries").mockResolvedValue([]),
        getPlaysByDayOfWeek: jest.spyOn(tautulliClient, "getPlaysByDayOfWeek").mockResolvedValue({}),
        getPlaysByHourOfDay: jest.spyOn(tautulliClient, "getPlaysByHourOfDay").mockResolvedValue({}),
    };
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("declaraciones para Gemini", () => {
    test("declara doce herramientas de Plex, cada una con nombre y parámetros", () => {
        expect(DUENDE_PLEX_TOOL_DECLARATIONS.map((d) => d.name).sort()).toEqual(Object.keys(DUENDE_PLEX_EXECUTORS).sort());
        expect(DUENDE_PLEX_TOOL_DECLARATIONS).toHaveLength(12);
        for (const d of DUENDE_PLEX_TOOL_DECLARATIONS) {
            expect(d.description.length).toBeGreaterThan(20);
            expect(d.parameters).toBeDefined();
        }
    });

    test("cada declaración tiene un ejecutor y viceversa", () => {
        for (const d of DUENDE_PLEX_TOOL_DECLARATIONS) expect(typeof DUENDE_PLEX_EXECUTORS[d.name]).toBe("function");
    });
});

describe("actividad de una persona", () => {
    test("sin cuenta de Plex vinculada lo dice sin consultar nada", async () => {
        const r = await ejecutar("consultar_actividad_plex", { persona: "Carla" });
        expect(r.error).toContain("no tiene su cuenta de Plex vinculada");
        expect(spies.getHistory).not.toHaveBeenCalled();
    });

    test("una persona que no se identifica en el servidor lo dice", async () => {
        const r = await ejecutar("consultar_actividad_plex", { persona: "Nadie" });
        expect(r.error).toContain("No identifico");
    });

    test("fuera de un servidor no hay consulta posible", async () => {
        const r = await ejecutar("consultar_actividad_plex", { persona: "Ana" }, contexto({ guild: null }));
        expect(r.error).toBe("Solo disponible en servidores.");
    });

    test("consulta el historial de su cuenta desde la fecha pedida, con días acotados", async () => {
        await ejecutar("consultar_actividad_plex", { persona: "Ana", dias: 999 });
        const [id, opciones] = [spies.getHistory.mock.calls[0][1].userId, spies.getHistory.mock.calls[0][1]];
        expect(id).toBe("tau-ana");
        expect(opciones.length).toBe(200);
        const hace365 = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        expect(opciones.afterDate).toBe(hace365);
    });

    test("sin días indicados usa 7, y el mínimo es 1", async () => {
        const porDefecto = await ejecutar("consultar_actividad_plex", { persona: "Ana" });
        expect(porDefecto.dias).toBe(7);
        const minimo = await ejecutar("consultar_actividad_plex", { persona: "Ana", dias: -4 });
        expect(minimo.dias).toBe(1);
        const uno = await ejecutar("consultar_actividad_plex", { persona: "Ana", dias: 1 });
        expect(uno.dias).toBe(1);
    });

    test("resume lo visto: series con sus episodios y películas sueltas", async () => {
        spies.getHistory.mockResolvedValue([
            { media_type: "episode", grandparent_title: "Severance", title: "Vía", date: 1_700_000_000 },
            { media_type: "episode", grandparent_title: "Severance", title: "Hola", date: 1_700_000_100 },
            { media_type: "movie", title: "Dune", date: 1_700_000_200 },
        ]);
        const r = await ejecutar("consultar_actividad_plex", { persona: "Ana", dias: 3 });
        expect(r.persona).toBe("Ana");
        expect(JSON.stringify(r)).toContain("Severance");
        expect(JSON.stringify(r)).toContain("Dune");
    });
});

describe("ahora mismo", () => {
    test("sin nadie viendo nada lo dice con una lista vacía", async () => {
        expect(await ejecutar("consultar_viendo_ahora", {})).toEqual({ viendo_ahora: [] });
    });

    test("cada sesión muestra quién, qué y cuánto le falta", async () => {
        spies.getActivity.mockResolvedValue([
            { friendly_name: "Ana", grandparent_title: "Severance", title: "Vía", progress_percent: "42", state: "playing" },
            { user: "bruno", full_title: "Dune (2021)", title: "Dune (2021)" },
            { title: "Sin nombre" },
        ]);
        const { viendo_ahora } = await ejecutar("consultar_viendo_ahora", {});
        expect(viendo_ahora[0]).toEqual({ usuario: "Ana", titulo: "Severance - Vía", progreso_pct: 42, estado: "playing" });
        expect(viendo_ahora[1]).toMatchObject({ usuario: "bruno", titulo: "Dune (2021)", progreso_pct: 0, estado: "reproduciendo" });
        expect(viendo_ahora[2]).toMatchObject({ usuario: "desconocido", titulo: "Sin nombre" });
    });
});

describe("tiempo visto", () => {
    test("suma las horas del periodo pedido y omite las del resto", async () => {
        spies.getUserWatchTimeStats.mockResolvedValue([
            { query_days: 30, total_time: 36000, total_plays: 12 },
            { query_days: 7, total_time: 7200, total_plays: 3 },
        ]);
        const r = await ejecutar("consultar_tiempo_visto", { persona: "Ana", periodo: "semana" });
        expect(r).toEqual({ persona: "Ana", periodo: "semana", horas_vistas: 2, reproducciones: 3 });
        expect(spies.getUserWatchTimeStats).toHaveBeenCalledWith(G, "tau-ana", "7");
    });

    test("sin estadísticas devuelve ceros, y sin periodo dice que es semana", async () => {
        const r = await ejecutar("consultar_tiempo_visto", { persona: "Ana" });
        expect(r).toEqual({ persona: "Ana", periodo: "semana", horas_vistas: 0, reproducciones: 0 });
    });

    test("sin cuenta vinculada no consulta", async () => {
        expect((await ejecutar("consultar_tiempo_visto", { persona: "Carla" })).error).toBeDefined();
        expect(spies.getUserWatchTimeStats).not.toHaveBeenCalled();
    });
});

describe("última conexión", () => {
    test("sin actividad lo dice", async () => {
        expect(await ejecutar("consultar_ultima_conexion", { persona: "Ana" })).toEqual({ persona: "Ana", sin_actividad: true });
    });

    test("da la fecha y el título de lo último visto, también si es un episodio", async () => {
        spies.getHistory.mockResolvedValue([{ grandparent_title: "Severance", title: "Vía", date: 1_700_000_000 }]);
        const r = await ejecutar("consultar_ultima_conexion", { persona: "Ana" });
        expect(r.titulo).toBe("Severance - Vía");
        expect(r.fecha).toBe("2023-11-14");
        expect(spies.getHistory.mock.calls[0][1]).toMatchObject({ userId: "tau-ana", length: 1 });
    });

    test("una película sin serie da solo su título", async () => {
        spies.getHistory.mockResolvedValue([{ title: "Dune", started: 1_700_000_000 }]);
        const r = await ejecutar("consultar_ultima_conexion", { persona: "Ana" });
        expect(r.titulo).toBe("Dune");
    });
});

describe("novedades de la biblioteca", () => {
    test("por defecto trae 5 y nunca más de 20 ni menos de 1", async () => {
        await ejecutar("consultar_novedades_plex", {});
        expect(spies.getRecentlyAdded.mock.calls[0][1]).toBe(5);
        await ejecutar("consultar_novedades_plex", { cantidad: 50 });
        expect(spies.getRecentlyAdded.mock.calls[1][1]).toBe(20);
        await ejecutar("consultar_novedades_plex", { cantidad: 0 });
        expect(spies.getRecentlyAdded.mock.calls[2][1]).toBe(5);
    });

    test("cada novedad muestra título, tipo y año", async () => {
        spies.getRecentlyAdded.mockResolvedValue([
            { grandparent_title: "Severance", title: "Temporada 2", media_type: "episode", year: 2025 },
            { title: "Dune", media_type: "movie" },
        ]);
        const { novedades } = await ejecutar("consultar_novedades_plex", {});
        expect(novedades).toEqual([
            { titulo: "Severance - Temporada 2", tipo: "episode", anyo: 2025 },
            { titulo: "Dune", tipo: "movie", anyo: null },
        ]);
    });
});

describe("comparar dos personas", () => {
    test("pone las horas de cada una bajo su nombre", async () => {
        spies.getUserWatchTimeStats
            .mockResolvedValueOnce([{ query_days: 30, total_time: 3600, total_plays: 2 }])
            .mockResolvedValueOnce([{ query_days: 30, total_time: 7200, total_plays: 5 }]);
        const r = await ejecutar("comparar_actividad_plex", { persona1: "Ana", persona2: "Bruno", periodo: "mes" });
        expect(r.Ana).toEqual({ horas_vistas: 1, reproducciones: 2 });
        expect(r.Bruno).toEqual({ horas_vistas: 2, reproducciones: 5 });
        expect(r.periodo).toBe("mes");
    });

    test("si una de las dos no tiene cuenta, se devuelve ese aviso", async () => {
        const r = await ejecutar("comparar_actividad_plex", { persona1: "Ana", persona2: "Carla" });
        expect(r.error).toContain("Carla");
    });

    test("si la primera no tiene cuenta, se devuelve su aviso", async () => {
        const r = await ejecutar("comparar_actividad_plex", { persona1: "Carla", persona2: "Ana" });
        expect(r.error).toContain("Carla");
    });
});

describe("rankings y estadísticas del servidor", () => {
    test("las películas y series más vistas del servidor, con sus horas", async () => {
        spies.getHomeStats.mockResolvedValue([
            { stat_id: "top_movies", rows: [{ title: "Dune", total_plays: 9, total_duration: 36000 }] },
            { stat_id: "top_tv", rows: [{ grandparent_title: "Severance", title: "Vía", total_plays: 4, total_duration: 7200 }] },
        ]);
        const r = await ejecutar("consultar_top_visto_server", { periodo: "año" });
        expect(r.top_peliculas).toEqual([{ titulo: "Dune", reproducciones: 9, horas: 10 }]);
        expect(r.top_series).toEqual([{ titulo: "Severance", reproducciones: 4, horas: 2 }]);
        expect(spies.getHomeStats).toHaveBeenCalledWith(G, 365, 5);
    });

    test("el top sin periodo es del mes", async () => {
        const r = await ejecutar("consultar_top_visto_server", {});
        expect(r.periodo).toBe("mes");
        expect(r.top_peliculas).toEqual([]);
    });

    test("el top del servidor no funciona fuera de un servidor", async () => {
        expect(await ejecutar("consultar_top_visto_server", {}, contexto({ guildId: null }))).toEqual({
            error: "Solo disponible en servidores.",
        });
    });

    test("el ranking ordena por reproducciones y se queda con diez", async () => {
        const usuarios = Array.from({ length: 12 }, (_, k) => `user${k}`);
        spies.getPlaysByTopUsers.mockResolvedValue({
            categories: usuarios,
            series: [{ data: usuarios.map((_, k) => k) }],
        });
        const { ranking, periodo } = await ejecutar("consultar_ranking_plex", {});
        expect(periodo).toBe("mes");
        expect(ranking).toHaveLength(10);
        expect(ranking[0]).toEqual({ usuario: "user11", reproducciones: 11 });
        expect(ranking[9].reproducciones).toBe(2);
    });

    test("el ranking sin datos sale vacío", async () => {
        expect((await ejecutar("consultar_ranking_plex", { periodo: "semana" })).ranking).toEqual([]);
    });

    test("las bibliotecas con su tipo y cuántos títulos tienen", async () => {
        spies.getLibraries.mockResolvedValue([
            { section_name: "Películas", section_type: "movie", count: "1200" },
            { section_name: "Series", section_type: "show" },
        ]);
        const { bibliotecas } = await ejecutar("consultar_bibliotecas_plex", {});
        expect(bibliotecas).toEqual([
            { nombre: "Películas", tipo: "movie", items: 1200 },
            { nombre: "Series", tipo: "show", items: 0 },
        ]);
    });

    test("el patrón de visionado da el día y la hora con más reproducciones", async () => {
        spies.getPlaysByDayOfWeek.mockResolvedValue({
            categories: ["lunes", "viernes", "domingo"],
            series: [{ data: [3, 9, 4] }],
        });
        spies.getPlaysByHourOfDay.mockResolvedValue({
            categories: [8, 22],
            series: [{ data: [1, 30] }],
        });
        const r = await ejecutar("consultar_patron_visionado", { periodo: "semana" });
        expect(r).toEqual({ periodo: "semana", dia_mas_activo: "viernes", hora_mas_activa: "22:00" });
    });

    test("sin datos de visionado no inventa un día ni una hora", async () => {
        const r = await ejecutar("consultar_patron_visionado", {});
        expect(r.dia_mas_activo).toBeNull();
        expect(r.hora_mas_activa).toBeNull();
    });
});

describe("búsqueda en la biblioteca", () => {
    test("sin título, o fuera de un servidor, no busca", async () => {
        expect(await ejecutar("buscar_en_plex", { titulo: "  " })).toEqual({ error: "Falta el título a buscar." });
        expect(await ejecutar("buscar_en_plex", { titulo: "Dune" }, contexto({ guildId: null }))).toEqual({
            error: "Solo disponible en servidores.",
        });
        expect(spies.search).not.toHaveBeenCalled();
    });

    test("si no hay coincidencias lo dice con el título buscado", async () => {
        const r = await ejecutar("buscar_en_plex", { titulo: "Nada" });
        expect(r).toEqual({ encontrado: false, titulo: "Nada" });
    });

    test("devuelve hasta cinco resultados, con la sinopsis recortada", async () => {
        spies.search.mockResolvedValue({
            movie: [{ title: "Dune", media_type: "movie", year: 2021, rating: 8.0, summary: "y".repeat(500) }],
            show: [
                { title: "Dune: Prophecy", media_type: "show" },
                { title: "a", media_type: "show" },
                { title: "b", media_type: "show" },
                { title: "c", media_type: "show" },
                { title: "d", media_type: "show" },
            ],
        });
        const r = await ejecutar("buscar_en_plex", { titulo: "Dune" });
        expect(r.encontrado).toBe(true);
        expect(r.resultados).toHaveLength(5);
        expect(r.resultados[0]).toMatchObject({ titulo: "Dune", tipo: "movie", anyo: 2021, nota: 8 });
        expect(r.resultados[0].sinopsis).toHaveLength(400);
        expect(r.resultados[1]).toMatchObject({ anyo: null, nota: null, sinopsis: null });
    });
});
