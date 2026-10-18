// Fase 10 (Plex): estrenos (#299), Wrapped anual (#381), viéndose ahora (#385), campeones del ranking (#389), votar la película (#393),
// sugerencias para el grupo (#399), sesión semanal (#403), pedidos rechazados (#406) y cancelar peticiones (#410). Seerr, Tautulli y
// Discord se simulan: no hay red.
jest.mock("../src/services/seerrClient", () => ({
    ...jest.requireActual("../src/services/seerrClient"),
    getConfig: jest.fn(() => ({ url: "http://seerr", apiKey: "clave", dailyRequestLimit: 5 })),
    getRequestsRaw: jest.fn(async () => []),
    getUsersDetailed: jest.fn(async () => []),
    getMediaTitle: jest.fn(async (guildId, tipo, tmdbId) => `Título ${tmdbId}`),
    getEstrenos: jest.fn(async () => []),
    resolveSeerrUserByDiscordId: jest.fn(async () => ({ id: 7 })),
    getPeticionesPendientesDe: jest.fn(async () => []),
    cancelarPeticion: jest.fn(async () => {}),
}));
const db = require("../src/core/db");
const seerrClient = require("../src/services/seerrClient");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const wrapped = require("../src/systems/plexWrapped");
const wrappedEnvios = require("../src/discord/envios/plexWrapped");
const campeones = require("../src/systems/plexCampeones");
const cine = require("../src/systems/cine");
const votos = require("../src/systems/cine/votos");
const series = require("../src/systems/cine/series");
const recomendaciones = require("../src/systems/recomendaciones");
const plexExtras = require("../src/systems/plexExtras");
const pedidosSeerr = require("../src/systems/pedidosSeerr");
const panelCine = require("../src/paneles/cine");
const panelExtras = require("../src/paneles/plexExtras");
const manejador = require("../src/perfil/plexExtras");

let n = 0;
const nuevoGuild = () => `g-f10-${++n}`;
const unix = (ms) => Math.floor(ms / 1000);
let filaId = 9000;
function ver(g, user, inicio, segundos, extra = {}) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie, titulo, inicio, segundos, visto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
        g,
        filaId++,
        String(user),
        extra.tipo || "episode",
        `rk${filaId}`,
        extra.serie ?? null,
        extra.titulo ?? "t",
        unix(inicio),
        segundos,
    );
}
const clienteDm = (cerrados = []) => {
    const enviados = new Map();
    return {
        enviados,
        users: {
            fetch: jest.fn(async (id) => ({
                send: jest.fn(async (p) => {
                    if (cerrados.includes(id)) throw new Error("cerrado");
                    enviados.set(id, [...(enviados.get(id) || []), p]);
                }),
            })),
        },
    };
};

afterEach(() => jest.restoreAllMocks());

describe("Wrapped anual (#381)", () => {
    const AHORA = Date.UTC(2027, 0, 1, 11); // 1 de enero de 2027, 12:00 en Madrid

    test("el año anterior y un resumen que solo cuenta ese año", () => {
        const g = nuevoGuild();
        expect(wrapped.anioAnterior(AHORA)).toEqual({
            mes: "2026",
            inicio: "2026-01-01",
            fin: "2026-12-31",
            etiqueta: "2026",
            anual: true,
        });
        ver(g, 1, Date.UTC(2026, 2, 10, 18), 2 * 3600, { serie: "Severance" });
        ver(g, 1, Date.UTC(2026, 10, 10, 18), 3600, { serie: "Shogun" });
        ver(g, 1, Date.UTC(2025, 11, 31, 12), 5 * 3600, { serie: "Vieja" });
        const r = wrapped.resumenPersonal(g, 1, wrapped.anioAnterior(AHORA));
        expect(r.horas).toBe(3);
        expect(wrapped.mensajePersonal(r)).toMatch(/Wrapped · 2026/);
        expect(wrapped.mensajePersonal(wrapped.resumenPersonal(g, 99, wrapped.anioAnterior(AHORA)))).toMatch(/Ese año no has visto nada/);
    });

    test("el 1 de enero se manda el del mes y el del año, una sola vez por persona, y a quien no vio nada no se le manda", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-a", "1", "A");
        plexLinks.setLink(g, "disc-b", "2", "B");
        ver(g, 1, Date.UTC(2026, 11, 20, 18), 3600, { serie: "X" }); // diciembre
        ver(g, 1, Date.UTC(2026, 5, 20, 18), 3600, { serie: "Y" }); // junio
        const c = {
            ...clienteDm(),
            guilds: { cache: new Map([[g, { id: g, name: "S" }]]) },
        };
        jest.spyOn(require("../src/services/tautulliClient"), "getConfig").mockReturnValue({ url: "", apiKey: "" });
        expect(await wrappedEnvios.enviarSiToca(c, AHORA)).toBe(2);
        const dms = c.enviados.get("disc-a");
        expect(dms).toHaveLength(2);
        expect(dms[0].content).toMatch(/diciembre de 2026/);
        expect(dms[1].content).toMatch(/Wrapped · 2026/);
        expect(c.enviados.has("disc-b")).toBe(false);
        expect(db.prepare("SELECT COUNT(*) AS n FROM plex_wrapped_anual_enviados WHERE guildId = ?").get(g).n).toBe(1);
        expect(await wrappedEnvios.enviarSiToca(c, AHORA + 3600000)).toBe(0); // aunque el bot se reinicie ese día
    });

    test("otro día 1 solo manda el del mes", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-a", "1", "A");
        ver(g, 1, Date.UTC(2026, 8, 20, 18), 3600, { serie: "X" });
        const c = { ...clienteDm(), guilds: { cache: new Map([[g, { id: g, name: "S" }]]) } };
        jest.spyOn(require("../src/services/tautulliClient"), "getConfig").mockReturnValue({ url: "", apiKey: "" });
        expect(await wrappedEnvios.enviarSiToca(c, Date.UTC(2026, 9, 1, 11))).toBe(1);
        expect(db.prepare("SELECT COUNT(*) AS n FROM plex_wrapped_anual_enviados WHERE guildId = ?").get(g).n).toBe(0);
    });
});

describe("campeones del ranking semanal (#389)", () => {
    test("se guarda uno por semana (sin duplicar), sin campeón si nadie vio nada, y el recuento de victorias", () => {
        const g = nuevoGuild();
        expect(campeones.guardar(g, "2026-10-05", null)).toBe(false);
        expect(campeones.guardar(g, "2026-10-05", { discordUserId: "a", plexUsername: "A", segundos: 0 })).toBe(false);
        campeones.guardar(g, "2026-10-05", { discordUserId: "a", plexUsername: "A", segundos: 7200 });
        campeones.guardar(g, "2026-10-05", { discordUserId: "a", plexUsername: "A", segundos: 7300 }); // publicarla dos veces
        campeones.guardar(g, "2026-10-12", { discordUserId: "b", plexUsername: "B", segundos: 3600 });
        campeones.guardar(g, "2026-10-19", { discordUserId: "a", plexUsername: "A", segundos: 100 });
        expect(campeones.ultimas(g).map((s) => s.semana)).toEqual(["2026-10-19", "2026-10-12", "2026-10-05"]);
        expect(campeones.victorias(g)).toEqual([
            { discordUserId: "a", victorias: 2 },
            { discordUserId: "b", victorias: 1 },
        ]);
    });

    test("publicar el ranking guarda el campeón, y una semana vacía no", async () => {
        const g = nuevoGuild();
        const ranking = require("../src/systems/plexRankingSemanal");
        plexLinks.setLink(g, "disc-a", "1", "A");
        guildSettings.setSetting(g, "plex.ranking_canal", "c1");
        const send = jest.fn(async () => {});
        const guild = { id: g, name: "S", channels: { cache: new Map([["c1", { isTextBased: () => true, name: "c", send }]]) } };
        const semana = { lunes: "2026-10-05", domingo: "2026-10-11" };
        await ranking.publicar(guild, { semana });
        expect(campeones.ultimas(g)).toEqual([]); // nadie vio nada
        ver(g, 1, Date.UTC(2026, 9, 7, 18), 5400, { serie: "X" });
        await ranking.publicar(guild, { semana });
        await ranking.publicar(guild, { semana });
        expect(campeones.ultimas(g)).toMatchObject([{ semana: "2026-10-05", discordUserId: "disc-a", segundos: 5400 }]);
        const pantalla = panelExtras.pantallaCampeones(g);
        expect(pantalla.embeds[0].data.fields[1].value).toMatch(/<@disc-a> — \*\*1\*\* semana/);
        expect(panelExtras.pantallaCampeones(nuevoGuild()).embeds[0].data.description).toMatch(/Todavía no hay campeones/);
    });
});

describe("votar la película de la sesión (#393)", () => {
    const crear = (peli, extra = {}) =>
        cine.crear({ guildId: "g", canalId: "c", organizador: "org", peli, inicio: Date.now() + 3600000 * 5, ...extra });

    test("las opciones se separan con |, sin repetir ni vacías, hasta 5", () => {
        expect(votos.parsearOpciones("Dune | Alien||  dune |Heat")).toEqual(["Dune", "Alien", "Heat"]);
        expect(votos.parsearOpciones("a|b|c|d|e|f|g")).toHaveLength(5);
        expect(votos.parsearOpciones("")).toEqual([]);
    });

    test("una sola película no tiene votación; varias sí, y la sesión se queda con la primera", () => {
        const sola = crear("Dune");
        expect(votos.opciones(sola)).toEqual([]);
        expect(cine.sesion(sola).peli).toBe("Dune");
        const varias = crear("Dune | Alien | Heat");
        expect(cine.sesion(varias).peli).toBe("Dune");
        expect(votos.opciones(varias).map((o) => o.titulo)).toEqual(["Dune", "Alien", "Heat"]);
    });

    test("vota quien está apuntado, puede votar varias y quitar el voto; gana la más votada, y en empate la primera propuesta", () => {
        const id = crear("Dune | Alien | Heat");
        cine.apuntar(id, "ana");
        cine.apuntar(id, "beto");
        expect(votos.votar(id, 1, "intruso").mensaje).toMatch(/Apúntate/);
        expect(votos.votar(id, 9, "ana").ok).toBe(false);
        expect(votos.ganadora(id)).toBeNull(); // sin votos: la del organizador
        expect(votos.votar(id, 2, "ana")).toEqual({ ok: true, votando: true });
        expect(votos.votar(id, 1, "beto").ok).toBe(true);
        expect(votos.ganadora(id).titulo).toBe("Alien"); // empate a 1: la propuesta antes
        votos.votar(id, 2, "beto");
        expect(votos.ganadora(id).titulo).toBe("Heat");
        expect(votos.votar(id, 2, "ana")).toEqual({ ok: true, votando: false }); // quita el voto
        expect(votos.opciones(id).map((o) => o.votos)).toEqual([0, 1, 1]);
    });

    test("el recordatorio nombra la ganadora (o la del organizador sin votos) y cierra la votación", async () => {
        const ahora = Date.now();
        const a = crear("Dune | Alien", { inicio: ahora + 5 * 60000 });
        const b = crear("Matrix | Heat", { inicio: ahora + 6 * 60000 });
        cine.apuntar(a, "ana");
        votos.votar(a, 1, "ana");
        const send = jest.fn(async () => {});
        const client = { channels: { fetch: async () => ({ send }) } };
        await cine.enviarRecordatorios(client, ahora);
        const textos = send.mock.calls.map((c) => c[0].content);
        expect(textos.some((t) => /Alien/.test(t) && !/Dune/.test(t))).toBe(true);
        expect(textos.some((t) => /Matrix/.test(t))).toBe(true);
        expect(votos.votar(a, 0, "ana").mensaje).toMatch(/cerró/);
        expect(b).toBeTruthy();
    });

    test("el mensaje de la sesión enseña los votos y los botones de voto", () => {
        const id = crear("Dune | Alien");
        cine.apuntar(id, "ana");
        votos.votar(id, 0, "ana");
        const p = panelCine.pantallaSesion(id);
        expect(p.embeds[0].data.description).toMatch(/1\. Dune — \*\*1\*\* voto/);
        expect(p.components[0].components.map((c) => c.data.custom_id)).toEqual([`cine_votar_${id}_0`, `cine_votar_${id}_1`]);
        const sola = panelCine.pantallaSesion(crear("Dune"));
        expect(sola.components).toHaveLength(1);
    });
});

describe("sugerencias para el grupo (#399)", () => {
    const G = nuevoGuild();
    const AHORA = Date.UTC(2026, 9, 8, 12);
    const hace = (d) => AHORA - d * 86400000;
    const rec = (tmdbId, titulo) => ({ tmdbId, mediaType: "movie", titulo, anyo: "2020", estadoCodigo: 1 });

    test("descarta lo visto por CUALQUIERA, deja fuera a quien no tiene Plex y nunca pasa de cinco", async () => {
        plexLinks.setLink(G, "disc-a", "1", "A");
        plexLinks.setLink(G, "disc-b", "2", "B");
        ver(G, 1, hace(5), 7200, { tipo: "movie", titulo: "Dune" });
        ver(G, 2, hace(5), 7200, { tipo: "movie", titulo: "Alien" });
        ver(G, 2, hace(6), 3600, { tipo: "movie", titulo: "Visto por B" });
        const deps = {
            buscar: jest.fn(async (g, titulo) => (titulo === "Dune" ? 1 : 2)),
            recomendar: jest.fn(async () => [
                rec(10, "Visto por B"),
                rec(11, "Nueva 1"),
                rec(12, "Nueva 2"),
                rec(13, "N3"),
                rec(14, "N4"),
                rec(15, "N5"),
                rec(16, "N6"),
            ]),
        };
        const r = await recomendaciones.generarGrupo(G, ["disc-a", "disc-b", "disc-sin-plex"], deps, { ahora: AHORA });
        expect(r.ok).toBe(true);
        expect(r.personas).toBe(2);
        expect(r.sugerencias.length).toBeLessThanOrEqual(5);
        expect(r.sugerencias.map((s) => s.titulo)).not.toContain("Visto por B");
        const p = panelCine.pantallaSugerencias(r);
        expect(p.components[0].components.every((c) => /^recomendar_pedir_movie_\d+$/.test(c.data.custom_id))).toBe(true);
    });

    test("si ningún apuntado tiene Plex vinculado, no hay sugerencias y se dice", async () => {
        const r = await recomendaciones.generarGrupo(
            G,
            ["nadie-1", "nadie-2"],
            { buscar: jest.fn(), recomendar: jest.fn() },
            { ahora: AHORA },
        );
        expect(r).toMatchObject({ ok: false, personas: 0 });
        expect(panelCine.pantallaSugerencias(r).embeds[0].data.description).toMatch(/Ninguno de los apuntados/);
    });
});

describe("sesión semanal fija (#403)", () => {
    const pantalla = (id) => ({ content: `sesión ${id}` });
    const clienteCanal = () => {
        const enviados = [];
        return { enviados, channels: { fetch: async () => ({ send: async (p) => (enviados.push(p), { id: `m${enviados.length}` }) }) } };
    };

    test("la siguiente semana, a la misma hora de Madrid aunque cambie el horario", () => {
        const verano = Date.parse("2026-10-15T19:00:00Z"); // jueves 21:00 en Madrid (UTC+2)
        expect(new Date(series.siguienteSemana(verano, "21:00", verano + 1000)).toISOString()).toBe("2026-10-22T19:00:00.000Z");
        // El 25 de octubre cambia la hora: el jueves 29 a las 21:00 ya son las 20:00 UTC.
        const cruce = series.siguienteSemana(Date.parse("2026-10-22T19:00:00Z"), "21:00", Date.parse("2026-10-23T00:00:00Z"));
        expect(new Date(cruce).toISOString()).toBe("2026-10-29T20:00:00.000Z");
    });

    test("crea la siguiente cuando empieza la anterior, una sola vez aunque el cron pase dos veces, y 🛑 para la serie", async () => {
        const g = nuevoGuild();
        const inicio = Date.now() + 3600000;
        const serieId = series.crear({
            guildId: g,
            canalId: "c",
            organizador: "org",
            peli: "Dune | Alien",
            hora: "21:00",
            primera: inicio,
        });
        const primera = cine.crear({ guildId: g, canalId: "c", organizador: "org", peli: "Dune | Alien", inicio, serieId });
        const c = clienteCanal();
        expect(await series.crearSiguientes(c, cine, pantalla, inicio - 1000)).toBe(0); // la primera aún no ha empezado
        expect(await series.crearSiguientes(c, cine, pantalla, inicio + 60000)).toBe(1);
        expect(await series.crearSiguientes(c, cine, pantalla, inicio + 120000)).toBe(0); // la nueva está en el futuro
        const todas = db.prepare("SELECT id, inicio, mensajeId FROM cine_sesiones WHERE serie_id = ? ORDER BY inicio").all(serieId);
        expect(todas).toHaveLength(2);
        expect(new Date(todas[1].inicio).getTime() - new Date(todas[0].inicio).getTime()).toBeGreaterThanOrEqual(6 * 86400000);
        expect(todas[1].mensajeId).toBe("m1");
        expect(votos.opciones(todas[1].id)).toHaveLength(2); // también se vota
        // 🛑 en la segunda: cancela esa y para la serie; la primera se queda como estaba.
        const r = cine.cancelar(todas[1].id, "org");
        expect(r).toMatchObject({ ok: true, serieParada: true });
        expect(cine.sesion(primera).cancelada).toBe(0);
        expect(series.serie(serieId).activa).toBe(0);
        const despues = Date.parse(todas[1].inicio) + 60000;
        expect(await series.crearSiguientes(c, cine, pantalla, despues)).toBe(0);
    });

    test("la misma ocurrencia no se crea dos veces (índice único)", () => {
        const g = nuevoGuild();
        const inicio = Date.now() + 86400000;
        const s = series.crear({ guildId: g, canalId: "c", organizador: "o", peli: "X", hora: "21:00", primera: inicio });
        expect(cine.crear({ guildId: g, canalId: "c", organizador: "o", peli: "X", inicio, serieId: s })).toBeTruthy();
        expect(cine.crear({ guildId: g, canalId: "c", organizador: "o", peli: "X", inicio, serieId: s })).toBeNull();
    });

    test("el mensaje de una sesión de serie lo indica", () => {
        const g = nuevoGuild();
        const inicio = Date.now() + 86400000;
        const s = series.crear({ guildId: g, canalId: "c", organizador: "o", peli: "X", hora: "21:00", primera: inicio });
        const id = cine.crear({ guildId: g, canalId: "c", organizador: "o", peli: "X", inicio, serieId: s });
        const p = panelCine.pantallaSesion(id);
        expect(p.embeds[0].data.description).toMatch(/cada semana/);
        expect(p.components.at(-1).components.at(-1).data.label).toMatch(/parar la serie/);
    });
});

describe("estrenos de la semana (#299)", () => {
    test("la lista sale de Seerr, con su fecha, y se guarda; sin respuesta, la pantalla lo dice", async () => {
        const g = nuevoGuild();
        const ahora = Date.parse("2026-10-14T10:00:00Z");
        seerrClient.getEstrenos.mockResolvedValueOnce([
            { tmdbId: 1, mediaType: "movie", titulo: "Estreno A", fecha: "2026-10-15", poster: "http://x/p.jpg", estadoCodigo: 1 },
            { tmdbId: 2, mediaType: "tv", titulo: "Estreno B", fecha: "2026-10-18", poster: null, estadoCodigo: 5 },
        ]);
        const r = await plexExtras.estrenosDeLaSemana(g, ahora);
        expect(seerrClient.getEstrenos).toHaveBeenLastCalledWith(g, "2026-10-14", "2026-10-20");
        const p = panelExtras.pantallaEstrenos(r);
        expect(p.embeds[0].data.thumbnail.url).toBe("http://x/p.jpg");
        expect(p.embeds[0].data.description).toMatch(/Estreno A/);
        // 📥 solo para lo que aún no está en Plex, con el mismo id que las recomendaciones (mismo flujo y mismo cupo).
        expect(p.components[0].components.map((c) => c.data.custom_id)).toEqual(["recomendar_pedir_movie_1"]);
        await plexExtras.estrenosDeLaSemana(g, ahora);
        expect(seerrClient.getEstrenos).toHaveBeenCalledTimes(1); // guardado

        seerrClient.getEstrenos.mockRejectedValueOnce(new Error("caído"));
        const caida = await plexExtras.estrenosDeLaSemana(nuevoGuild(), ahora);
        expect(caida.ok).toBe(false);
        expect(panelExtras.pantallaEstrenos(caida).embeds[0].data.description).toMatch(/caído/);
        seerrClient.getEstrenos.mockResolvedValueOnce([]);
        expect(panelExtras.pantallaEstrenos(await plexExtras.estrenosDeLaSemana(nuevoGuild(), ahora)).embeds[0].data.description).toMatch(
            /No hay estrenos/,
        );
    });
});

describe("viéndose ahora (#385)", () => {
    test("las sesiones con nombre de Discord si la cuenta está vinculada y «alguien» si no; sin nadie, lo dice", async () => {
        const g = nuevoGuild();
        plexLinks.setLink(g, "disc-ana", "5", "Ana");
        const tautulli = {
            getActivity: jest.fn(async () => [
                { user_id: 5, grandparent_title: "Severance", title: "Ep 3", progress_percent: "40", state: "playing" },
                { user_id: 99, full_title: "Dune", progress_percent: "75", state: "paused" },
            ]),
        };
        const r = await plexExtras.reproduciendoAhora(g, { tautulliClient: tautulli, plexLinks });
        const texto = panelExtras.pantallaAhora(r).embeds[0].data.description;
        expect(texto).toMatch(/<@disc-ana> — \*\*Severance - Ep 3\*\* \(40 %\)/);
        expect(texto).toMatch(/⏸️ alguien — \*\*Dune\*\* \(75 %\)/);
        const vacia = await plexExtras.reproduciendoAhora(g, { tautulliClient: { getActivity: async () => [] }, plexLinks });
        expect(panelExtras.pantallaAhora(vacia).embeds[0].data.description).toMatch(/Nadie está viendo Plex/);
        const caida = await plexExtras.reproduciendoAhora(g, {
            tautulliClient: {
                getActivity: async () => {
                    throw new Error("sin red");
                },
            },
            plexLinks,
        });
        expect(panelExtras.pantallaAhora(caida).embeds[0].data.description).toMatch(/sin red/);
    });

    test("el botón responde en privado", async () => {
        const g = nuevoGuild();
        jest.spyOn(require("../src/services/tautulliClient"), "getActivity").mockResolvedValue([]);
        const i = {
            customId: "plexx_ahora",
            guildId: g,
            user: { id: "u" },
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        await manejador.handleButton(null, i);
        expect(i.deferReply.mock.calls[0][0].flags).toBeTruthy();
        expect(i.editReply.mock.calls[0][0].embeds[0].data.description).toMatch(/Nadie está viendo/);
    });
});

describe("pedidos de Seerr: rechazados (#406) y cancelar (#410)", () => {
    const G = nuevoGuild();
    const pedido = (id, estadoPeticion, seerrUserId = 1) => ({
        id,
        mediaType: "movie",
        tmdbId: 100 + id,
        estadoCodigo: 1,
        seerrUserId,
        plexUsername: null,
        estadoPeticion,
    });
    const clienteDiscord = () => {
        const dms = [];
        const canal = { name: "n", isTextBased: () => true, send: jest.fn(async () => {}) };
        return {
            dms,
            canal,
            guilds: {
                cache: new Map([[G, { id: G, name: "S", channels: { cache: new Map([["nov", canal]]), fetch: async () => null } }]]),
            },
            users: { fetch: async (id) => ({ send: async (p) => dms.push({ id, p }) }) },
        };
    };

    beforeAll(() => {
        guildSettings.setSetting(G, "plex.novedades_channel_id", "nov");
        seerrClient.getUsersDetailed.mockResolvedValue([{ id: 1, plexUsername: "raul", discordIds: ["111111111111111111"] }]);
    });

    test("la primera comprobación fija la base; después un rechazo avisa una sola vez en el canal", async () => {
        seerrClient.getRequestsRaw.mockResolvedValue([pedido(1, 3), pedido(2, 2)]);
        const c = clienteDiscord();
        expect(await pedidosSeerr.avisarRechazados(c)).toBe(0);
        expect(c.canal.send).not.toHaveBeenCalled();
        seerrClient.getRequestsRaw.mockResolvedValue([pedido(1, 3), pedido(2, 3), pedido(3, 1)]);
        expect(await pedidosSeerr.avisarRechazados(c)).toBe(1);
        expect(c.canal.send.mock.calls[0][0].content).toMatch(/<@111111111111111111>.*rechazado.*Título 102/);
        expect(await pedidosSeerr.avisarRechazados(c)).toBe(0);
    });

    test("sin canal de novedades, por DM", async () => {
        const G2 = nuevoGuild();
        guildSettings.setSetting(G2, "plex.novedades_channel_id", "");
        const c = {
            dms: [],
            guilds: { cache: new Map([[G2, { id: G2, name: "S2", channels: { cache: new Map(), fetch: async () => null } }]]) },
        };
        c.users = { fetch: async (id) => ({ send: async (p) => c.dms.push({ id, p }) }) };
        seerrClient.getRequestsRaw.mockResolvedValue([pedido(10, 1)]);
        await pedidosSeerr.avisarRechazados(c);
        seerrClient.getRequestsRaw.mockResolvedValue([pedido(10, 3)]);
        expect(await pedidosSeerr.avisarRechazados(c)).toBe(1);
        expect(c.dms[0].id).toBe("111111111111111111");
    });

    test("solo salen y se cancelan las peticiones propias que siguen pendientes, y si Seerr falla queda como estaba", async () => {
        const g = nuevoGuild();
        seerrClient.getPeticionesPendientesDe.mockResolvedValue([{ id: 5, mediaType: "movie", tmdbId: 1, titulo: "Mi peli" }]);
        const lista = await plexExtras.pedidosPendientes(g, "disc-x");
        expect(lista.pedidos).toHaveLength(1);
        expect(seerrClient.getPeticionesPendientesDe).toHaveBeenLastCalledWith(g, 7);
        expect(panelExtras.pantallaPedidos(lista).components[0].components[0].data.custom_id).toBe("plexx_cancelar");

        const ok = await plexExtras.cancelarPedido(g, "disc-x", 5);
        expect(ok.ok).toBe(true);
        expect(seerrClient.cancelarPeticion).toHaveBeenCalledWith(g, 5);
        const ajena = await plexExtras.cancelarPedido(g, "disc-x", 99);
        expect(ajena.ok).toBe(false);
        expect(seerrClient.cancelarPeticion).toHaveBeenCalledTimes(1);
        seerrClient.cancelarPeticion.mockRejectedValueOnce(new Error("500"));
        const falla = await plexExtras.cancelarPedido(g, "disc-x", 5);
        expect(falla).toMatchObject({ ok: false });
        expect(falla.mensaje).toMatch(/Sigue como estaba/);
    });

    test("sin perfil de Seerr o sin pendientes lo dice; el menú repinta la lista", async () => {
        const g = nuevoGuild();
        seerrClient.resolveSeerrUserByDiscordId.mockResolvedValueOnce(null);
        expect((await plexExtras.pedidosPendientes(g, "x")).ok).toBe(false);
        seerrClient.getPeticionesPendientesDe.mockResolvedValue([]);
        expect(panelExtras.pantallaPedidos(await plexExtras.pedidosPendientes(g, "x")).embeds[0].data.description).toMatch(
            /ninguna petición pendiente/,
        );
        seerrClient.getPeticionesPendientesDe
            .mockResolvedValueOnce([{ id: 8, mediaType: "tv", tmdbId: 2, titulo: "Serie" }])
            .mockResolvedValue([]);
        const i = {
            customId: "plexx_cancelar",
            guildId: g,
            user: { id: "x" },
            values: ["8"],
            deferUpdate: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        await manejador.handleSelect(null, i);
        expect(i.editReply.mock.calls[0][0].embeds[0].data.description).toMatch(/He cancelado tu petición de \*\*Serie\*\*/);
    });
});
