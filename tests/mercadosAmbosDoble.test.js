// Mercados «ambos marcan» y «doble oportunidad» (#532): quién acierta en cada resultado, cuándo se ofrecen (solo con todas
// sus cuotas y antes de empezar), cómo se leen de la API partido a partido sin gastar créditos de más, la ficha del partido,
// apostar de punta a punta, combinadas y la liquidación. BD en memoria y la Odds API simulada con `global.fetch`.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercados = require("../src/systems/apuestas/mercados");
const combinadas = require("../src/systems/apuestas/combinadas");
const misJugadas = require("../src/systems/apuestas/misJugadas");
const { eleccionDeBoton } = require("../src/systems/apuestas/formularioApuesta");
const oddsApi = require("../src/services/oddsApi");
const repoOdds = require("../src/repositorios/odds");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");
const apuestas = require("../src/juegos/apuestas/apuestas");
const { embedPartido, filasPartido } = require("../src/juegos/apuestas/partido");

const G = "g-ambos-doble";
const FUTURO = "2099-01-01T20:00:00.000Z";
const hace = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
const fetchOriginal = global.fetch;
const entornoOriginal = { ...process.env };
let n = 0;

const EXTRAS = { cuota_ambos_si: 1.8, cuota_ambos_no: 2.0, cuota_dc_1x: 1.3, cuota_dc_12: 1.25, cuota_dc_x2: 1.9 };

function partido(id, { start = FUTURO, extras = EXTRAS } = {}) {
    db.prepare("DELETE FROM apuestas_partidos WHERE match_id = ?").run(id);
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
            cuota_ambos_si, cuota_ambos_no, cuota_dc_1x, cuota_dc_12, cuota_dc_x2)
         VALUES (?, 'laliga', 'Local', 'Visitante', ?, 'abierto', 2.0, 3.0, 4.0, ?, ?, ?, ?, ?)`,
    ).run(id, start, extras.cuota_ambos_si, extras.cuota_ambos_no, extras.cuota_dc_1x, extras.cuota_dc_12, extras.cuota_dc_x2);
    return db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(id);
}

const respuesta = (data, restantes = "400") => ({
    ok: true,
    headers: new Map([["x-requests-remaining", restantes]]),
    json: async () => data,
});

beforeEach(() => {
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    delete process.env.ODDS_MERCADOS_EXTRA;
});

afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
});

afterAll(() => {
    process.env = entornoOriginal;
});

describe("quién acierta (#532)", () => {
    // [marcador, resultado, ambos sí, 1X, 12, X2]
    test.each([
        ["2-1", "home", true, true, true, false],
        ["1-0", "home", false, true, true, false],
        ["1-1", "draw", true, true, false, true],
        ["0-0", "draw", false, true, false, true],
        ["0-2", "away", false, false, true, true],
        ["1-3", "away", true, false, true, true],
    ])("con %s (%s)", (marcador, resultado, ambos, d1x, d12, dx2) => {
        expect(mercados.acierta("ambossi", resultado, marcador, null)).toBe(ambos);
        expect(mercados.acierta("ambosno", resultado, marcador, null)).toBe(!ambos);
        expect(mercados.acierta("dc1x", resultado, marcador, null)).toBe(d1x);
        expect(mercados.acierta("dc12", resultado, marcador, null)).toBe(d12);
        expect(mercados.acierta("dcx2", resultado, marcador, null)).toBe(dx2);
    });

    test("ambos marcan sin marcador no se puede decidir y no se paga", () => {
        expect(mercados.acierta("ambossi", "home", null, null)).toBe(false);
        expect(mercados.acierta("ambosno", "home", "", null)).toBe(false);
    });

    test("el mejor escenario de 1X + X2 es el empate, que cobra las dos", () => {
        const boleto = [
            { eleccion: "dc1x", cantidad: 100, cuota: 1.3 },
            { eleccion: "dcx2", cantidad: 100, cuota: 1.9 },
        ];
        expect(mercados.maximoPorMarcador(boleto)).toBe(130 + 190);
    });
});

describe("cuándo se ofrecen (#532)", () => {
    test("con todas sus cuotas salen los cinco botones con el nombre completo", () => {
        const b = mercados.botonesDisponibles(partido("ad-ofrece"));
        expect(b.map((x) => x.eleccion)).toEqual(["ambossi", "ambosno", "dc1x", "dc12", "dcx2"]);
        expect(b.map((x) => x.etiqueta)).toEqual([
            "⚽ Ambos marcan: Sí",
            "⚽ Ambos marcan: No",
            "🔀 Doble oportunidad: 1X",
            "🔀 Doble oportunidad: 12",
            "🔀 Doble oportunidad: X2",
        ]);
    });

    test("si falta una cuota de su grupo, ese mercado no se ofrece; el otro sí", () => {
        const p = partido("ad-falta", { extras: { ...EXTRAS, cuota_ambos_no: null } });
        expect(mercados.botonesDisponibles(p).map((x) => x.eleccion)).toEqual(["dc1x", "dc12", "dcx2"]);
        expect(mercados.tieneDoble(p)).toBe(true);
        const sinNada = partido("ad-nada", { extras: {} });
        expect(mercados.botonesDisponibles(sinNada)).toEqual([]);
        expect(mercados.tieneDoble(sinNada)).toBe(false);
    });

    test("al empezar el partido se cierran (sus cuotas no se refrescan en directo)", () => {
        const p = partido("ad-empezado", { start: hace(0.5) });
        expect(mercados.cuotaDe(p, "ambossi")).toBeNull();
        expect(mercados.cuotaDe(p, "dc1x")).toBeNull();
        expect(mercados.botonesExtra(p)).toEqual([]);
        expect(mercados.cuotaDe(partido("ad-antes"), "dc12")).toBe(1.25);
    });

    test("cada apuesta se nombra sin siglas sueltas", () => {
        expect(mercados.textoEleccion({ eleccion: "ambossi" })).toBe("Ambos marcan: Sí");
        expect(mercados.textoEleccion({ eleccion: "dcx2" })).toBe("Doble oportunidad: X2");
    });

    test("los botones se reconocen en el customId", () => {
        expect(eleccionDeBoton("apuesta_mercado_dc1x_abc_123")).toEqual({ eleccion: "dc1x", matchId: "abc_123" });
        expect(eleccionDeBoton("apuesta_mercado_ambosno_m1")).toEqual({ eleccion: "ambosno", matchId: "m1" });
        expect(eleccionDeBoton("apuesta_mercado_dc21_m1")).toBeNull();
    });
});

describe("la ficha del partido (#532)", () => {
    const filas = (p) => filasPartido(p, p.match_id).map((f) => f.toJSON().components);

    test("los mercados nuevos van en su propia fila, sin pasar los límites de Discord y con ids únicos", () => {
        const p = partido("ad-ficha");
        const f = filas(p);
        expect(f.length).toBeLessThanOrEqual(5);
        for (const fila of f) expect(fila.length).toBeLessThanOrEqual(5);
        const ids = f.flat().map((c) => c.custom_id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(
            f.some(
                (fila) =>
                    fila.map((c) => c.custom_id).join() ===
                    ["ambossi", "ambosno", "dc1x", "dc12", "dcx2"].map((e) => `apuesta_mercado_${e}_ad-ficha`).join(),
            ),
        ).toBe(true);
    });

    test("se pueden sumar a la combinada desde el menú", () => {
        const menu = filas(partido("ad-menu"))
            .flat()
            .find((c) => c.custom_id === "combinada_sumar_ad-menu");
        expect(menu.options.map((o) => o.value)).toEqual(expect.arrayContaining(["ambossi", "dcx2"]));
    });

    test("el texto lleva las cuotas y la leyenda de la doble oportunidad", () => {
        const texto = embedPartido(partido("ad-texto")).data.description;
        expect(texto).toContain("⚽ Ambos marcan: Sí: cuota `1.8`");
        expect(texto).toContain(mercados.LEYENDA_DOBLE);
    });

    test("sin esas cuotas la ficha queda como antes: sin fila extra ni leyenda", () => {
        const p = partido("ad-sin", { extras: {} });
        expect(
            filas(p)
                .flat()
                .some((c) => /ambos|dc1x/.test(c.custom_id || "")),
        ).toBe(false);
        expect(embedPartido(p).data.description).not.toContain("Doble oportunidad");
    });
});

describe("leer las cuotas de la API (#532)", () => {
    const evento = (markets) => ({ home_team: "Local", away_team: "Visitante", bookmakers: [{ key: "x", markets }] });

    test("ambos marcan sale de Yes/No y la doble oportunidad de los nombres de los equipos", () => {
        const x = oddsApi.cuotasExtra(
            evento([
                {
                    key: "btts",
                    outcomes: [
                        { name: "Yes", price: 1.7 },
                        { name: "No", price: 2.1 },
                    ],
                },
                {
                    key: "double_chance",
                    outcomes: [
                        { name: "Draw/Visitante", price: 2.0 },
                        { name: "Local/Draw", price: 1.2 },
                        { name: "Local/Visitante", price: 1.3 },
                    ],
                },
            ]),
        );
        expect(x).toEqual({ cuota_ambos_si: 1.7, cuota_ambos_no: 2.1, cuota_dc_1x: 1.2, cuota_dc_12: 1.3, cuota_dc_x2: 2.0 });
    });

    test("también entiende 1X, 12 y X2 aunque vengan desordenados", () => {
        const x = oddsApi.cuotasExtra(
            evento([
                {
                    key: "double_chance",
                    outcomes: [
                        { name: "X1", price: 1.2 },
                        { name: "21", price: 1.3 },
                        { name: "2X", price: 2 },
                    ],
                },
            ]),
        );
        expect(x).toMatchObject({ cuota_dc_1x: 1.2, cuota_dc_12: 1.3, cuota_dc_x2: 2 });
    });

    test("un mercado a medias o ausente se queda a null entero", () => {
        const x = oddsApi.cuotasExtra(
            evento([
                { key: "btts", outcomes: [{ name: "Yes", price: 1.7 }] },
                { key: "double_chance", outcomes: [{ name: "Local/Draw", price: 1.2 }] },
            ]),
        );
        expect(Object.values(x).every((v) => v === null)).toBe(true);
        expect(Object.values(oddsApi.cuotasExtra({ bookmakers: [] })).every((v) => v === null)).toBe(true);
    });
});

describe("pedirlas sin gastar créditos de más (#532)", () => {
    const AHORA = Date.parse("2098-06-01T20:00:00.000Z");
    const dentro = new Date(AHORA + 3600 * 1000).toISOString();
    const lejos = new Date(AHORA + 10 * 24 * 3600 * 1000).toISOString();
    const eventoApi = {
        home_team: "Local",
        away_team: "Visitante",
        bookmakers: [
            {
                markets: [
                    {
                        key: "btts",
                        outcomes: [
                            { name: "Yes", price: 1.6 },
                            { name: "No", price: 2.2 },
                        ],
                    },
                ],
            },
        ],
    };
    const limpiar = () => db.prepare("DELETE FROM apuestas_partidos WHERE match_id LIKE 'ext-%'").run();
    beforeEach(limpiar);

    test("apagadas por defecto: no se pide nada", async () => {
        partido("ext-1", { start: dentro, extras: {} });
        global.fetch = jest.fn();
        expect(await oddsApi.pedirMercadosExtra("laliga", AHORA)).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("activadas: piden por partido, guardan las cuotas y no repiten hasta el refresco", async () => {
        process.env.ODDS_MERCADOS_EXTRA = "btts,double_chance,inventado";
        partido("ext-1", { start: dentro, extras: {} });
        partido("ext-lejos", { start: lejos, extras: {} });
        global.fetch = jest.fn(async () => respuesta(eventoApi));

        expect(await oddsApi.pedirMercadosExtra("laliga", AHORA)).toBe(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const url = global.fetch.mock.calls[0][0];
        expect(url).toContain("/soccer_spain_la_liga/events/ext-1/odds?");
        expect(url).toContain("markets=btts,double_chance");
        expect(url).not.toContain("inventado");
        const fila = db
            .prepare("SELECT cuota_ambos_si, cuota_ambos_no, cuota_dc_1x, extras_ts FROM apuestas_partidos WHERE match_id = 'ext-1'")
            .get();
        expect(fila).toEqual({ cuota_ambos_si: 1.6, cuota_ambos_no: 2.2, cuota_dc_1x: null, extras_ts: AHORA });

        expect(await oddsApi.pedirMercadosExtra("laliga", AHORA + 60 * 1000)).toBe(0);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("respetan el tope de partidos por pasada", async () => {
        process.env.ODDS_MERCADOS_EXTRA = "btts";
        process.env.ODDS_EXTRA_MAX = "2";
        for (let i = 0; i < 4; i++) partido(`ext-tope-${i}`, { start: dentro, extras: {} });
        global.fetch = jest.fn(async () => respuesta(eventoApi));
        expect(await oddsApi.pedirMercadosExtra("laliga", AHORA)).toBe(2);
        delete process.env.ODDS_EXTRA_MAX;
    });

    test("un partido que falla no para a los demás", async () => {
        process.env.ODDS_MERCADOS_EXTRA = "btts";
        partido("ext-a", { start: dentro, extras: {} });
        partido("ext-b", { start: new Date(AHORA + 2 * 3600 * 1000).toISOString(), extras: {} });
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 404, headers: new Map(), text: async () => "EVENT_NOT_FOUND" })
            .mockResolvedValueOnce(respuesta(eventoApi));
        expect(await oddsApi.pedirMercadosExtra("laliga", AHORA)).toBe(1);
        expect(db.prepare("SELECT cuota_ambos_si FROM apuestas_partidos WHERE match_id = 'ext-b'").get().cuota_ambos_si).toBe(1.6);
    });

    test("si la API retira el mercado, deja de ofrecerse", () => {
        partido("ext-retirado", { start: dentro });
        repoOdds.guardarMercadosExtra("ext-retirado", { cuota_ambos_si: null, cuota_ambos_no: null }, AHORA);
        const p = db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = 'ext-retirado'").get();
        expect(mercados.cuotaDe(p, "ambossi", AHORA)).toBeNull();
    });

    test("actualizar las cuotas normales no borra las de ambos marcan y doble oportunidad", () => {
        partido("ext-upsert");
        repoOdds.guardarPartidos("laliga", [
            {
                m: { id: "ext-upsert", home_team: "Local", away_team: "Visitante", commence_time: FUTURO },
                c: { home: 2.1, draw: 3.1, away: 3.9 },
                x: { cuota_mas: null, cuota_menos: null, total_linea: null, cuota_casa: null, cuota_fuera: null, hcap_linea: null },
            },
        ]);
        expect(db.prepare("SELECT cuota_home, cuota_dc_12 FROM apuestas_partidos WHERE match_id = 'ext-upsert'").get()).toEqual({
            cuota_home: 2.1,
            cuota_dc_12: 1.25,
        });
    });
});

describe("apostar y liquidar (#532)", () => {
    let resultadosApi = {};
    const score = (id, h, a) => ({
        id,
        completed: true,
        home_team: "Local",
        away_team: "Visitante",
        scores: [
            { name: "Local", score: String(h) },
            { name: "Visitante", score: String(a) },
        ],
    });
    const empezar = (...ids) =>
        ids.forEach((id) => db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(hace(5), id));
    const usarResultados = () => {
        global.fetch = jest.fn(async (url) => respuesta(resultadosApi[/sports\/([^/]+)\/scores/.exec(url)?.[1]] || []));
    };

    async function apostar(userId, matchId, eleccion, cantidad = "100") {
        const boton = {
            customId: `apuesta_mercado_${eleccion}_${matchId}`,
            user: { id: userId, tag: userId },
            guildId: G,
            showModal: jest.fn(),
            reply: jest.fn(),
        };
        await apuestas.handleButton(null, boton);
        const modal = {
            customId: `apuestas_modal_${eleccion}_${matchId}`,
            user: { id: userId, tag: userId },
            guildId: G,
            fields: { getStringSelectValues: () => null, getTextInputValue: (id) => (id === "cantidad" ? cantidad : "") },
            reply: jest.fn(),
        };
        if (boton.showModal.mock.calls.length) await apuestas.handleModal(null, modal);
        return { boton, modal };
    }

    test("apostar a doble oportunidad cobra una vez y guarda la cuota, sin línea", async () => {
        const u = `ad-u-${++n}`;
        dinero.pagar(u, 1000);
        partido("ad-apuesta");
        const antes = dinero.efectivo(u);
        const { modal } = await apostar(u, "ad-apuesta", "dc1x");
        expect(modal.reply.mock.calls[0][0].embeds[0].data.title).toBe("✅ ¡Apuesta registrada!");
        expect(dinero.efectivo(u)).toBe(antes - 100);
        expect(db.prepare("SELECT eleccion, cuota, linea FROM apuestas_usuario WHERE user_id = ?").get(u)).toEqual({
            eleccion: "dc1x",
            cuota: 1.3,
            linea: null,
        });
    });

    test("sin cuota del proveedor el botón no deja apostar ni cobra", async () => {
        const u = `ad-u-${++n}`;
        dinero.pagar(u, 1000);
        partido("ad-sin-cuota", { extras: {} });
        const antes = dinero.efectivo(u);
        const { boton } = await apostar(u, "ad-sin-cuota", "ambossi");
        expect(boton.showModal).not.toHaveBeenCalled();
        expect(boton.reply).toHaveBeenCalled();
        expect(dinero.efectivo(u)).toBe(antes);
    });

    test("ya empezado (en directo) no se puede apostar a ambos marcan", async () => {
        const prev = process.env.ODDS_DIRECTO;
        process.env.ODDS_DIRECTO = "1";
        const u = `ad-u-${++n}`;
        dinero.pagar(u, 1000);
        partido("ad-directo", { start: hace(0.5) });
        const { boton } = await apostar(u, "ad-directo", "ambossi");
        expect(boton.showModal).not.toHaveBeenCalled();
        expect(db.prepare("SELECT COUNT(*) AS c FROM apuestas_usuario WHERE user_id = ?").get(u).c).toBe(0);
        if (prev === undefined) delete process.env.ODDS_DIRECTO;
        else process.env.ODDS_DIRECTO = prev;
    });

    test.each([
        ["victoria local 2-1", 2, 1, { ambossi: 180, ambosno: 0, dc1x: 130, dc12: 125, dcx2: 0 }],
        ["empate 0-0", 0, 0, { ambossi: 0, ambosno: 200, dc1x: 130, dc12: 0, dcx2: 190 }],
        ["victoria visitante 1-3", 1, 3, { ambossi: 180, ambosno: 0, dc1x: 0, dc12: 125, dcx2: 190 }],
    ])("la liquidación paga lo correcto con %s, una sola vez", async (_caso, h, a, premios) => {
        const id = `ad-liq-${++n}`;
        partido(id);
        const usuarios = {};
        for (const eleccion of Object.keys(premios)) {
            const u = `ad-liq-u-${n}-${eleccion}`;
            dinero.pagar(u, 1000);
            await apostar(u, id, eleccion);
            usuarios[eleccion] = { u, antes: dinero.efectivo(u) };
        }
        empezar(id);
        resultadosApi = { soccer_spain_la_liga: [score(id, h, a)] };
        usarResultados();

        await liquidarApuestas({ minHorasDesdeInicio: 2 });
        await liquidarApuestas({ minHorasDesdeInicio: 2 });

        for (const [eleccion, premio] of Object.entries(premios)) {
            const { u, antes } = usuarios[eleccion];
            expect(dinero.efectivo(u)).toBe(antes + premio);
            expect(db.prepare("SELECT pagado, premio FROM apuestas_usuario WHERE user_id = ?").get(u)).toEqual({ pagado: 1, premio });
        }
    });

    test("se combinan con otros partidos y la combinada se paga si aciertan todas las patas", async () => {
        const u = `ad-comb-${++n}`;
        dinero.pagar(u, 1000);
        partido(`ad-comb-a-${n}`);
        partido(`ad-comb-b-${n}`);
        expect(combinadas.sumar(u, `ad-comb-a-${n}`, "ambossi").ok).toBe(true);
        expect(combinadas.sumar(u, `ad-comb-b-${n}`, "dcx2").ok).toBe(true);
        const r = combinadas.apostar(G, u, 100);
        expect(r.ok).toBe(true);
        const antes = dinero.efectivo(u);
        empezar(`ad-comb-a-${n}`, `ad-comb-b-${n}`);
        resultadosApi = { soccer_spain_la_liga: [score(`ad-comb-a-${n}`, 1, 1), score(`ad-comb-b-${n}`, 0, 0)] };
        usarResultados();

        await liquidarApuestas({ minHorasDesdeInicio: 2 });
        // 1,8 × 1,9 = 3,42 → 342
        expect(db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(r.id)).toEqual({ estado: "ganada", premio: 342 });
        expect(dinero.efectivo(u)).toBe(antes + 342);
    });

    test("«Mis jugadas» muestra el nombre completo y la cuota actual", async () => {
        const u = `ad-mis-${++n}`;
        dinero.pagar(u, 1000);
        partido("ad-mis");
        await apostar(u, "ad-mis", "ambosno");
        const [a] = misJugadas.partidosDe(u);
        expect(mercados.textoEleccion(a)).toBe("Ambos marcan: No");
        expect(misJugadas.cuotaActual(a)).toBe(2.0);
    });
});
