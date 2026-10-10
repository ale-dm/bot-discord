// 🔴 Apuestas en directo (#12): con ODDS_DIRECTO=1 se puede apostar mientras el partido se juega (hasta 2 horas después
// del inicio), con las cuotas que se refrescan; sin esa variable, todo se cierra al empezar. La API se simula.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const directo = require("../src/systems/apuestas/directo");
const apuestas = require("../src/juegos/apuestas/apuestas");
const oddsApi = require("../src/services/oddsApi");

const G = "g-directo";
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
const FUTURO = "2099-01-01T20:00:00.000Z";
let n = 0;

beforeEach(() => {
    delete process.env.ODDS_DIRECTO;
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM apuestas_partidos WHERE match_id LIKE 'd-%'").run();
});
afterEach(() => {
    delete process.env.ODDS_DIRECTO;
    jest.restoreAllMocks();
});

function partido(id, { start, estado = "abierto", deporte = "laliga" } = {}) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away)
         VALUES (?, ?, 'Local', 'Visitante', ?, ?, 2.0, 3.0, 4.0)`,
    ).run(id, deporte, start, estado);
    return db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(id);
}

describe("cuándo se puede apostar", () => {
    test("antes del partido, siempre", () => {
        const p = { estado: "abierto", start_time: FUTURO };
        expect(directo.abiertoParaApostar(p)).toBe(true);
    });

    test("sin ODDS_DIRECTO, un partido empezado ya está cerrado", () => {
        const p = { estado: "abierto", start_time: hace(30) };
        expect(directo.abiertoParaApostar(p)).toBe(false);
    });

    test("con ODDS_DIRECTO=1, se puede apostar durante las 2 horas del partido, y no después", () => {
        process.env.ODDS_DIRECTO = "1";
        expect(directo.abiertoParaApostar({ estado: "abierto", start_time: hace(30) })).toBe(true);
        expect(directo.abiertoParaApostar({ estado: "abierto", start_time: hace(121) })).toBe(false);
        expect(directo.abiertoParaApostar({ estado: "finalizado", start_time: hace(30) })).toBe(false);
    });

    test("el listado incluye los partidos en juego solo con ODDS_DIRECTO=1", () => {
        const ahora = Date.now();
        expect(directo.inicioListado(ahora)).toBe(new Date(ahora).toISOString());
        process.env.ODDS_DIRECTO = "1";
        expect(directo.inicioListado(ahora)).toBe(new Date(ahora - directo.DURACION_MS).toISOString());
    });
});

test("apostar a un partido en juego: se rechaza sin la variable y se acepta con ella", async () => {
    const id = `d-${++n}`;
    partido(id, { start: hace(30) });
    const u = `directo-${n}`;
    dinero.pagar(u, 1000);
    const enviar = async () => {
        const reply = jest.fn();
        await apuestas.handleModal(null, {
            customId: `apuestas_modal_home_${id}`,
            user: { id: u, tag: u },
            guildId: G,
            fields: { getStringSelectValues: () => null, getTextInputValue: () => "50" },
            reply,
        });
        return reply.mock.calls[0][0].embeds[0].data.title;
    };
    expect(await enviar()).toMatch(/Apuestas cerradas/);
    process.env.ODDS_DIRECTO = "1";
    expect(await enviar()).toBe("✅ ¡Apuesta registrada!");
    expect(db.prepare("SELECT cuota FROM apuestas_usuario WHERE user_id = ? AND match_id = ?").get(u, id).cuota).toBe(2);
});

test("refrescar en directo: sin la variable no hace nada; con ella, pide las cuotas de las competiciones en juego", async () => {
    const id = `d-${++n}`;
    partido(id, { start: hace(30), deporte: "premier" });
    partido(`d-${++n}`, { start: FUTURO, deporte: "champions" }); // aún no ha empezado: no se refresca por esto
    const fetchEspia = jest.fn(async () => ({
        ok: true,
        headers: new Map([["x-requests-remaining", "300"]]),
        json: async () => [
            {
                id,
                home_team: "Local",
                away_team: "Visitante",
                commence_time: hace(30),
                bookmakers: [
                    {
                        markets: [
                            {
                                key: "h2h",
                                outcomes: [
                                    { name: "Local", price: 1.5 },
                                    { name: "Draw", price: 4 },
                                    { name: "Visitante", price: 6 },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    }));
    global.fetch = fetchEspia;

    expect(await oddsApi.refrescarEnDirecto()).toBe(0);
    expect(fetchEspia).not.toHaveBeenCalled();

    process.env.ODDS_DIRECTO = "1";
    expect(await oddsApi.refrescarEnDirecto()).toBe(1);
    expect(fetchEspia.mock.calls[0][0]).toMatch(/soccer_epl\/odds/);
    expect(db.prepare("SELECT cuota_home FROM apuestas_partidos WHERE match_id = ?").get(id).cuota_home).toBe(1.5);
});
