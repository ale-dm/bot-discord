// Cliente de la Odds API con fetch simulado: caché de cuotas, actualización de partidos ya
// guardados y lectura de resultados.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const odds = require("../src/services/oddsApi");

const partidoApi = (id, commence, [h, d, a]) => ({
    id,
    home_team: "Local",
    away_team: "Visitante",
    commence_time: commence,
    bookmakers: [
        {
            markets: [
                {
                    key: "h2h",
                    outcomes: [
                        { name: "Local", price: h },
                        { name: "Draw", price: d },
                        { name: "Visitante", price: a },
                    ],
                },
            ],
        },
    ],
});

let respuesta = [];
beforeEach(() => {
    odds._limpiarCache();
    global.fetch = jest.fn(async () => ({ ok: true, headers: new Map([["x-requests-remaining", "450"]]), json: async () => respuesta }));
});

test("guarda los partidos y reutiliza las cuotas durante la caché", async () => {
    respuesta = [partidoApi("m1", "2030-01-01T20:00:00Z", [1.5, 3.2, 5])];
    await odds.sincronizarPartidos("laliga");
    await odds.sincronizarPartidos("laliga");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT cuota_home, cuota_draw, cuota_away FROM apuestas_partidos WHERE match_id = 'm1'").get()).toEqual({
        cuota_home: 1.5,
        cuota_draw: 3.2,
        cuota_away: 5,
    });
});

test("actualiza cuotas y hora de un partido abierto (aplazado), pero no uno cerrado", async () => {
    respuesta = [partidoApi("m2", "2030-01-01T20:00:00Z", [2, 3, 4]), partidoApi("m3", "2030-01-01T20:00:00Z", [2, 3, 4])];
    await odds.sincronizarPartidos("premier");
    db.prepare("UPDATE apuestas_partidos SET estado = 'finalizado' WHERE match_id = 'm3'").run();

    odds._limpiarCache();
    respuesta = [partidoApi("m2", "2030-01-08T20:00:00Z", [1.8, 3.1, 4.5]), partidoApi("m3", "2030-01-08T20:00:00Z", [9, 9, 9])];
    await odds.sincronizarPartidos("premier");

    expect(db.prepare("SELECT start_time, cuota_home FROM apuestas_partidos WHERE match_id = 'm2'").get()).toEqual({
        start_time: "2030-01-08T20:00:00Z",
        cuota_home: 1.8,
    });
    expect(db.prepare("SELECT cuota_home FROM apuestas_partidos WHERE match_id = 'm3'").get().cuota_home).toBe(2);
});

test("un error de la API incluye el motivo", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, headers: new Map(), text: async () => '{"message":"clave inválida"}' }));
    await expect(odds.sincronizarPartidos("champions")).rejects.toThrow(/401.*clave inválida/);
});

describe("resultadoDeScore", () => {
    const score = (scores) => ({ completed: true, home_team: "Betis", away_team: "Sevilla", scores });

    test("busca a cada equipo por nombre aunque vengan en otro orden", () => {
        const r = odds.resultadoDeScore(
            score([
                { name: "Sevilla", score: "0" },
                { name: "Betis", score: "2" },
            ]),
        );
        expect(r.resultado).toBe("home");
    });

    test("empate y partido sin terminar", () => {
        const empate = score([
            { name: "Betis", score: "1" },
            { name: "Sevilla", score: "1" },
        ]);
        expect(odds.resultadoDeScore(empate).resultado).toBe("draw");
        expect(odds.resultadoDeScore({ ...empate, completed: false })).toBeNull();
    });
});
