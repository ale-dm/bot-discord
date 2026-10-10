// Cliente de Tautulli (services/tautulliClient.js): configuración, parámetros de cada comando, la forma de las
// respuestas (datos sueltos, {} y errores de Tautulli), la lista de canales permitidos y el aviso de novedades
// del canal. axios.get está simulado: no sale nada a la red.
const axios = require("axios");
const guildSettings = require("../src/systems/guildSettings");
const tautulli = require("../src/services/tautulliClient");

const G = "g-tautulli-cliente";
const CLAVE = "clave-tautulli-de-prueba";
let plexCfg;
let peticion;

// Respuesta de Tautulli con la forma { response: { result, message, data } }.
const ok = (data) => ({ data: { response: { result: "success", message: null, data } } });
const fallo = (message) => ({ data: { response: { result: "error", message } } });
// Error de axios con código HTTP (Tautulli contesta 400 cuando no tiene el elemento).
const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { response: { status } });

// Qué responde Tautulli a cada comando. Si no hay respuesta preparada, la cadena de test falla con un mensaje claro.
function responderA(tabla) {
    peticion.mockImplementation(async (url, opciones) => {
        const cmd = opciones.params.cmd;
        const r = tabla[cmd];
        if (r === undefined) throw new Error(`sin respuesta preparada para ${cmd}`);
        return typeof r === "function" ? r(opciones) : r;
    });
}
const ultimoParams = () => peticion.mock.calls.at(-1)[1].params;

beforeEach(() => {
    plexCfg = { tautulli_url: "https://tautulli.local/", tautulli_api_key: CLAVE };
    jest.spyOn(guildSettings, "getSettings").mockImplementation(() => ({ plex: plexCfg }));
    peticion = jest.spyOn(axios, "get");
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("configuración", () => {
    test("usa la del servidor y quita las barras finales", () => {
        expect(tautulli.getConfig(G)).toEqual({ url: "https://tautulli.local", apiKey: CLAVE });
    });

    test("sin ajustes del servidor cae a las variables de entorno", () => {
        plexCfg = {};
        process.env.TAUTULLI_URL = "http://env.local///";
        process.env.TAUTULLI_API_KEY = "clave-env";
        try {
            expect(tautulli.getConfig(G)).toEqual({ url: "http://env.local", apiKey: "clave-env" });
        } finally {
            delete process.env.TAUTULLI_URL;
            delete process.env.TAUTULLI_API_KEY;
        }
    });

    test("sin servidor solo mira el entorno y no pregunta por ajustes", () => {
        process.env.TAUTULLI_URL = "http://solo-env.local";
        try {
            expect(tautulli.getConfig(null)).toEqual({ url: "http://solo-env.local", apiKey: "" });
            expect(guildSettings.getSettings).not.toHaveBeenCalled();
        } finally {
            delete process.env.TAUTULLI_URL;
        }
    });

    test("sin URL o sin clave, cualquier comando falla antes de salir", async () => {
        plexCfg = { tautulli_url: "https://tautulli.local" };
        await expect(tautulli.getUsers(G)).rejects.toThrow("Tautulli no está configurado");
        expect(peticion).not.toHaveBeenCalled();
    });
});

describe("llamadas a la API", () => {
    test("cada comando va a /api/v2 con la clave, el comando y un timeout de 10 s", async () => {
        responderA({ get_users: ok([]) });
        await tautulli.getUsers(G);
        const [url, opciones] = peticion.mock.calls[0];
        expect(url).toBe("https://tautulli.local/api/v2");
        expect(opciones.params).toEqual({ apikey: CLAVE, cmd: "get_users" });
        expect(opciones.timeout).toBe(10000);
    });

    test("un error de red sin respuesta se propaga y se registra el código", async () => {
        peticion.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
        await expect(tautulli.getActivity(G)).rejects.toThrow("ECONNREFUSED");
    });

    test("un HTTP 500 se propaga como error de red, no como respuesta de Tautulli", async () => {
        peticion.mockRejectedValue(httpError(500));
        const err = await tautulli.getActivity(G).catch((e) => e);
        expect(err.message).toBe("HTTP 500");
        expect(err.respuestaDeTautulli).toBeUndefined();
    });

    test("un HTTP 400 es «Tautulli no tiene ese elemento», marcado como respuesta suya", async () => {
        peticion.mockRejectedValue(httpError(400));
        const err = await tautulli.getActivity(G).catch((e) => e);
        expect(err.message).toContain("no tiene el elemento pedido en get_activity");
        expect(err.respuestaDeTautulli).toBe(true);
    });

    test("result distinto de success se lanza con el mensaje de Tautulli", async () => {
        peticion.mockResolvedValue(fallo("API key no válida"));
        const err = await tautulli.getUsers(G).catch((e) => e);
        expect(err.message).toBe("Tautulli respondió con error en get_users: API key no válida");
        expect(err.respuestaDeTautulli).toBe(true);
    });

    test("una respuesta sin cuerpo se describe como desconocida", async () => {
        peticion.mockResolvedValue({ data: {} });
        await expect(tautulli.getUsers(G)).rejects.toThrow("Tautulli respondió con error en get_users: desconocido");
    });
});

describe("comandos de datos", () => {
    test("getUsers quita al usuario «Local» (user_id 0)", async () => {
        responderA({
            get_users: ok([
                { user_id: 0, username: "Local" },
                { user_id: 7, username: "ana" },
            ]),
        });
        expect(await tautulli.getUsers(G)).toEqual([{ user_id: 7, username: "ana" }]);
    });

    test("getUsers sin datos devuelve lista vacía", async () => {
        responderA({ get_users: ok(null) });
        expect(await tautulli.getUsers(G)).toEqual([]);
    });

    test("getHistory: por defecto 50 filas; con usuario y fecha, lo añade a los parámetros", async () => {
        responderA({ get_history: ok({ data: [{ row_id: 1 }] }) });
        expect(await tautulli.getHistory(G)).toEqual([{ row_id: 1 }]);
        expect(ultimoParams()).toEqual({ apikey: CLAVE, cmd: "get_history", length: 50 });

        await tautulli.getHistory(G, { userId: 7, afterDate: "2026-01-01", length: 10 });
        expect(ultimoParams()).toMatchObject({ length: 10, user_id: 7, after: "2026-01-01" });
    });

    test("getHistory sin datos devuelve lista vacía", async () => {
        responderA({ get_history: ok(null) });
        expect(await tautulli.getHistory(G)).toEqual([]);
    });

    test("getHistoryPage pide sin agrupar, de la más reciente a la más antigua", async () => {
        responderA({ get_history: ok({ data: [{ row_id: 9 }] }) });
        expect(await tautulli.getHistoryPage(G)).toEqual([{ row_id: 9 }]);
        expect(ultimoParams()).toEqual({
            apikey: CLAVE,
            cmd: "get_history",
            start: 0,
            length: 1000,
            grouping: 0,
            order_column: "date",
            order_dir: "desc",
        });
        await tautulli.getHistoryPage(G, { start: 2000, length: 500, after: "2025-06-01" });
        expect(ultimoParams()).toMatchObject({ start: 2000, length: 500, after: "2025-06-01" });
    });

    test("getHistoryPage sin datos devuelve lista vacía", async () => {
        responderA({ get_history: ok({}) });
        expect(await tautulli.getHistoryPage(G)).toEqual([]);
    });

    test("getMetadata devuelve la ficha si tiene rating_key", async () => {
        responderA({ get_metadata: ok({ rating_key: 101, title: "Origen" }) });
        expect(await tautulli.getMetadata(G, 101)).toEqual({ rating_key: 101, title: "Origen" });
        expect(ultimoParams()).toMatchObject({ cmd: "get_metadata", rating_key: 101 });
    });

    test("getMetadata devuelve null si la ficha viene vacía, sin rating_key o si Tautulli la rechaza", async () => {
        responderA({ get_metadata: ok({}) });
        expect(await tautulli.getMetadata(G, 1)).toBeNull();

        responderA({ get_metadata: ok(null) });
        expect(await tautulli.getMetadata(G, 1)).toBeNull();

        responderA({ get_metadata: fallo("no existe") });
        expect(await tautulli.getMetadata(G, 1)).toBeNull();

        peticion.mockRejectedValue(httpError(400));
        expect(await tautulli.getMetadata(G, 1)).toBeNull();
    });

    test("getMetadata deja pasar un fallo de red", async () => {
        peticion.mockRejectedValue(httpError(503));
        await expect(tautulli.getMetadata(G, 1)).rejects.toThrow("HTTP 503");
    });

    test("getChildrenMetadata pasa el tipo y devuelve los hijos; sin hijos o con error de Tautulli, lista vacía", async () => {
        responderA({ get_children_metadata: ok({ children_list: [{ rating_key: 5, media_index: 1 }] }) });
        expect(await tautulli.getChildrenMetadata(G, 9, "season")).toEqual([{ rating_key: 5, media_index: 1 }]);
        expect(ultimoParams()).toMatchObject({ rating_key: 9, media_type: "season" });

        responderA({ get_children_metadata: ok({}) });
        expect(await tautulli.getChildrenMetadata(G, 9, "season")).toEqual([]);

        responderA({ get_children_metadata: fallo("no existe") });
        expect(await tautulli.getChildrenMetadata(G, 9, "season")).toEqual([]);

        peticion.mockRejectedValue(httpError(400));
        expect(await tautulli.getChildrenMetadata(G, 9, "season")).toEqual([]);

        peticion.mockRejectedValue(httpError(502));
        await expect(tautulli.getChildrenMetadata(G, 9, "season")).rejects.toThrow("HTTP 502");
    });

    test("getStreamData devuelve los datos técnicos; vacíos o sin datos de Tautulli, null", async () => {
        responderA({ get_stream_data: ok({ audio_language: "Español" }) });
        expect(await tautulli.getStreamData(G, 42)).toEqual({ audio_language: "Español" });
        expect(ultimoParams()).toMatchObject({ row_id: 42 });

        responderA({ get_stream_data: ok({}) });
        expect(await tautulli.getStreamData(G, 42)).toBeNull();

        responderA({ get_stream_data: fallo("sin datos") });
        expect(await tautulli.getStreamData(G, 42)).toBeNull();

        peticion.mockRejectedValue(httpError(400));
        expect(await tautulli.getStreamData(G, 42)).toBeNull();

        peticion.mockRejectedValue(httpError(500));
        await expect(tautulli.getStreamData(G, 42)).rejects.toThrow("HTTP 500");
    });

    test("getLibraryMediaInfo pide una página ordenada por título, con 60 s de margen", async () => {
        responderA({ get_library_media_info: ok({ data: [{ rating_key: 1 }], recordsFiltered: "3" }) });
        const r = await tautulli.getLibraryMediaInfo(G, 1);
        expect(r).toEqual({ filas: [{ rating_key: 1 }], total: 3 });
        expect(ultimoParams()).toMatchObject({ section_id: 1, start: 0, length: 1000, order_column: "sort_title", order_dir: "asc" });
        expect(peticion.mock.calls[0][1].timeout).toBe(60000);
    });

    test("getLibraryMediaInfo cae al total sin filtrar y, si no hay ninguno, a 0", async () => {
        responderA({ get_library_media_info: ok({ data: [], recordsTotal: "5" }) });
        expect((await tautulli.getLibraryMediaInfo(G, 1, { start: 10, length: 20 })).total).toBe(5);
        expect(ultimoParams()).toMatchObject({ start: 10, length: 20 });

        responderA({ get_library_media_info: ok(null) });
        expect(await tautulli.getLibraryMediaInfo(G, 1)).toEqual({ filas: [], total: 0 });
    });

    test("getUserWatchTimeStats mira 7, 30 y todo el tiempo por defecto", async () => {
        responderA({ get_user_watch_time_stats: ok([{ query_days: 7 }]) });
        expect(await tautulli.getUserWatchTimeStats(G, 7)).toEqual([{ query_days: 7 }]);
        expect(ultimoParams()).toMatchObject({ user_id: 7, query_days: "7,30,0" });

        responderA({ get_user_watch_time_stats: ok(null) });
        expect(await tautulli.getUserWatchTimeStats(G, 7)).toEqual([]);
    });

    test("getActivity devuelve las sesiones activas, o lista vacía", async () => {
        responderA({ get_activity: ok({ sessions: [{ title: "Dune" }] }) });
        expect(await tautulli.getActivity(G)).toEqual([{ title: "Dune" }]);
        responderA({ get_activity: ok({}) });
        expect(await tautulli.getActivity(G)).toEqual([]);
    });

    test("getRecentlyAdded pide 5 por defecto y acepta otra cantidad", async () => {
        responderA({ get_recently_added: ok({ recently_added: [{ title: "A" }] }) });
        expect(await tautulli.getRecentlyAdded(G)).toEqual([{ title: "A" }]);
        expect(ultimoParams().count).toBe(5);
        await tautulli.getRecentlyAdded(G, 15);
        expect(ultimoParams().count).toBe(15);
        responderA({ get_recently_added: ok({}) });
        expect(await tautulli.getRecentlyAdded(G)).toEqual([]);
    });

    test("getLibraries, search, getHomeStats: datos o valor vacío por defecto", async () => {
        responderA({
            get_libraries: ok(null),
            search: ok({ results_list: { movie: [{ title: "Dune" }] } }),
            get_home_stats: ok(null),
        });
        expect(await tautulli.getLibraries(G)).toEqual([]);
        expect(await tautulli.search(G, "dune")).toEqual({ movie: [{ title: "Dune" }] });
        expect(ultimoParams()).toMatchObject({ cmd: "search", query: "dune" });
        expect(await tautulli.getHomeStats(G)).toEqual([]);
        await tautulli.getHomeStats(G, 7, 3);
        expect(ultimoParams()).toMatchObject({ time_range: 7, stats_count: 3 });

        responderA({ search: ok(null) });
        expect(await tautulli.search(G, "x")).toEqual({});
    });

    test("las gráficas de reproducciones devuelven categorías y series vacías si Tautulli no manda datos", async () => {
        const vacio = { categories: [], series: [] };
        responderA({
            get_plays_by_top_10_users: ok(null),
            get_plays_by_dayofweek: ok(null),
            get_plays_by_hourofday: ok({ categories: ["0h"], series: [] }),
        });
        expect(await tautulli.getPlaysByTopUsers(G)).toEqual(vacio);
        expect(await tautulli.getPlaysByDayOfWeek(G, 90)).toEqual(vacio);
        expect(ultimoParams()).toMatchObject({ time_range: 90 });
        expect(await tautulli.getPlaysByHourOfDay(G)).toEqual({ categories: ["0h"], series: [] });
    });
});

describe("prueba de conexión", () => {
    test("cuenta a los usuarios sin el «Local»", async () => {
        responderA({ get_users: ok([{ user_id: 0 }, { user_id: 1 }, { user_id: 2 }]) });
        expect(await tautulli.testConnection(G)).toEqual({ ok: true, userCount: 2 });
    });

    test("si falla, lo dice con el error y no lanza", async () => {
        peticion.mockRejectedValue(new Error("timeout de prueba"));
        expect(await tautulli.testConnection(G)).toEqual({ ok: false, error: "timeout de prueba" });
    });
});

describe("canales permitidos para Plex", () => {
    const C = "g-tautulli-canales";

    afterEach(() => {
        tautulli.clearAllowedChannels(C);
    });

    test("sin canales en la lista, cualquier canal puede usar Plex", () => {
        expect(tautulli.getAllowedChannels(C)).toEqual([]);
        expect(tautulli.isChannelAllowed(C, "cualquiera")).toBe(true);
    });

    test("al añadir un canal, la lista pasa a ser una allowlist ordenada por nombre", () => {
        tautulli.addAllowedChannel(C, "c-zeta", "zeta");
        tautulli.addAllowedChannel(C, "c-alfa", "Alfa");
        expect(tautulli.getAllowedChannels(C)).toEqual([
            { channelId: "c-alfa", channelName: "Alfa" },
            { channelId: "c-zeta", channelName: "zeta" },
        ]);
        expect(tautulli.isChannelAllowed(C, "c-alfa")).toBe(true);
        expect(tautulli.isChannelAllowed(C, "c-otro")).toBe(false);
    });

    test("añadir de nuevo un canal solo actualiza su nombre; sin nombre queda en null", () => {
        tautulli.addAllowedChannel(C, "c-1", "viejo");
        tautulli.addAllowedChannel(C, "c-1", "nuevo");
        tautulli.addAllowedChannel(C, "c-2");
        // Orden por nombre ascendente: en SQLite el NULL va primero.
        expect(tautulli.getAllowedChannels(C)).toEqual([
            { channelId: "c-2", channelName: null },
            { channelId: "c-1", channelName: "nuevo" },
        ]);
    });

    test("quitar un canal lo saca de la lista; quitar el último devuelve la lista a sin restricción", () => {
        tautulli.addAllowedChannel(C, "c-1", "uno");
        tautulli.removeAllowedChannel(C, "c-1");
        expect(tautulli.getAllowedChannels(C)).toEqual([]);
        expect(tautulli.isChannelAllowed(C, "c-1")).toBe(true);
    });

    test("clearAllowedChannels vacía la lista de ese servidor y no toca la de otros", () => {
        tautulli.addAllowedChannel(C, "c-1", "uno");
        tautulli.addAllowedChannel("g-otro-tautulli", "c-9", "nueve");
        tautulli.clearAllowedChannels(C);
        expect(tautulli.getAllowedChannels(C)).toEqual([]);
        expect(tautulli.getAllowedChannels("g-otro-tautulli")).toHaveLength(1);
        tautulli.clearAllowedChannels("g-otro-tautulli");
    });
});

describe("aviso automático de novedades", () => {
    let canalDeGuild;

    function servidor(id, { canal = null, enviar = async () => {} } = {}) {
        const canales = new Map();
        const chan = canal && { id: canal, name: "novedades", isTextBased: () => true, send: jest.fn(enviar) };
        if (chan) canales.set(canal, chan);
        const guild = { id, name: `Servidor ${id}`, channels: { cache: canales, fetch: jest.fn(async () => null) } };
        canalDeGuild[id] = canal;
        return { guild, chan };
    }
    const cliente = (...guilds) => ({ guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } });
    const novedades = (items) => responderA({ get_recently_added: ok({ recently_added: items }) });
    const serie = (added_at, title, grandparent_title = "Severance") => ({
        added_at: String(added_at),
        media_type: "episode",
        title,
        grandparent_title,
        year: 2022,
    });

    beforeEach(() => {
        canalDeGuild = {};
        jest.spyOn(guildSettings, "getSettings").mockImplementation((id) => ({
            plex: { tautulli_url: "https://tautulli.local", tautulli_api_key: CLAVE, novedades_channel_id: canalDeGuild[id] },
        }));
    });

    test("un servidor sin canal de novedades ni siquiera pregunta a Tautulli", async () => {
        const { guild } = servidor("g-nov-sin-canal");
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(peticion).not.toHaveBeenCalled();
    });

    test("la primera vez fija la base sin publicar lo que ya había", async () => {
        const { guild, chan } = servidor("g-nov-base", { canal: "c-nov-1" });
        novedades([serie(100, "Ep 1"), serie(200, "Ep 2")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(chan.send).not.toHaveBeenCalled();
        expect(ultimoParams()).toMatchObject({ cmd: "get_recently_added", count: 15 });
    });

    test("después publica solo lo más nuevo que la base, en orden de llegada", async () => {
        const { guild, chan } = servidor("g-nov-orden", { canal: "c-nov-2" });
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));

        novedades([
            serie(300, "Ep 3"),
            serie(100, "Ep viejo"),
            serie(200, "Ep 2"),
            { added_at: "400", media_type: "movie", title: "Dune", year: 2021 },
            { added_at: "500", media_type: "music", title: "Un disco" },
        ]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));

        expect(chan.send.mock.calls.map(([t]) => t)).toEqual([
            "📺 **Nuevo en Plex:** Severance — Ep 2 (2022)",
            "📺 **Nuevo en Plex:** Severance — Ep 3 (2022)",
            "🎬 **Nuevo en Plex:** Dune (2021)",
            "🎞️ **Nuevo en Plex:** Un disco",
        ]);
    });

    test("sin nada nuevo no escribe en el canal", async () => {
        const { guild, chan } = servidor("g-nov-nada", { canal: "c-nov-3" });
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(chan.send).not.toHaveBeenCalled();
    });

    test("un episodio sin título de serie usa solo su título y una película sin año no lleva paréntesis", async () => {
        const { guild, chan } = servidor("g-nov-formato", { canal: "c-nov-4" });
        novedades([{ added_at: "10", media_type: "episode", title: "Piloto" }]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        novedades([
            { added_at: "10", media_type: "episode", title: "Piloto" },
            { added_at: "20", media_type: "movie", title: "Sin año" },
            { added_at: "30", media_type: "episode", title: "Piloto suelto" },
        ]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(chan.send.mock.calls.map(([t]) => t)).toEqual(["🎬 **Nuevo en Plex:** Sin año", "📺 **Nuevo en Plex:** Piloto suelto"]);
    });

    test("si el canal no está en caché se busca con fetch", async () => {
        const { guild } = servidor("g-nov-fetch", { canal: "c-nov-5" });
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));

        const canalRecuperado = { id: "c-nov-5", name: "novedades", isTextBased: () => true, send: jest.fn(async () => {}) };
        guild.channels.cache.clear();
        guild.channels.fetch.mockResolvedValueOnce(canalRecuperado);
        novedades([serie(200, "Ep 2")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(guild.channels.fetch).toHaveBeenCalledWith("c-nov-5");
        expect(canalRecuperado.send).toHaveBeenCalledTimes(1);
    });

    test("si el canal no existe o no es de texto no se envía nada y el resto de servidores sigue", async () => {
        const { guild: sinCanal } = servidor("g-nov-no-existe", { canal: "c-fantasma" });
        sinCanal.channels.cache.clear();
        const { guild: sinTexto, chan: voz } = servidor("g-nov-voz", { canal: "c-voz" });
        voz.isTextBased = () => false;

        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(sinCanal, sinTexto));
        novedades([serie(200, "Ep 2")]);
        await tautulli.checkAllGuildsForNewContent(cliente(sinCanal, sinTexto));
        expect(voz.send).not.toHaveBeenCalled();
    });

    test("un fallo de Tautulli en un servidor no impide avisar en el siguiente", async () => {
        const { guild: caido } = servidor("g-nov-caido", { canal: "c-caido" });
        const { guild: sano, chan } = servidor("g-nov-sano", { canal: "c-sano" });
        // Primera vuelta: ambos fijan base.
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(caido, sano));

        // Segunda vuelta: la primera consulta (servidor caído) falla; la segunda (servidor sano) trae una novedad.
        novedades([serie(200, "Ep 2")]);
        peticion.mockRejectedValueOnce(httpError(500));
        await tautulli.checkAllGuildsForNewContent(cliente(caido, sano));
        expect(chan.send).toHaveBeenCalledTimes(1);
        expect(chan.send.mock.calls[0][0]).toContain("Ep 2");
    });

    test("un fallo al publicar una novedad no corta las siguientes", async () => {
        let intentos = 0;
        const { guild, chan } = servidor("g-nov-envio", {
            canal: "c-nov-6",
            enviar: async () => {
                intentos++;
                if (intentos === 1) throw new Error("Missing Permissions");
            },
        });
        novedades([serie(100, "Ep 1")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        novedades([serie(200, "Ep 2"), serie(300, "Ep 3")]);
        await tautulli.checkAllGuildsForNewContent(cliente(guild));
        expect(chan.send).toHaveBeenCalledTimes(2);
        expect(chan.send.mock.calls[1][0]).toContain("Ep 3");
    });
});
