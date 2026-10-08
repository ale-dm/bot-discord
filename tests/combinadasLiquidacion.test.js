// Combinadas (#1) liquidadas de punta a punta con la Odds API simulada: se apuesta con los partidos abiertos y se
// liquida cuando ya han empezado (como hace el cron cada hora).
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const combinadas = require("../src/systems/apuestas/combinadas");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");

const FUTURO = "2099-01-01T20:00:00.000Z";
const hace = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
let resultadosApi = {};
let n = 0;

beforeEach(() => {
    resultadosApi = {};
    global.fetch = jest.fn(async (url) => {
        const deporte = /sports\/([^/]+)\/scores/.exec(url)[1];
        return { ok: true, headers: new Map([["x-requests-remaining", "400"]]), json: async () => resultadosApi[deporte] || [] };
    });
});

const score = (id, home, away) => ({
    id,
    completed: true,
    scores: [
        { name: "L", score: String(home) },
        { name: "V", score: String(away) },
    ],
});

function partido(id) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
            cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea)
         VALUES (?, 'laliga', 'Local', 'Visitante', ?, 'abierto', 2.0, 3.0, 4.0, 1.9, 1.95, 2.5, 2.3, 1.6, -1.5)`,
    ).run(id, FUTURO);
}
/** Se mueve el partido al pasado, como cuando empieza de verdad. */
const empezar = (...ids) =>
    ids.forEach((id) => db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(hace(5), id));

function boleto(userId, { cantidad = 100, legs }) {
    dinero.pagar(userId, 1000);
    for (const [matchId, eleccion] of legs) {
        partido(matchId);
        combinadas.sumar(userId, matchId, eleccion);
    }
    return combinadas.apostar("g-comb-liq", userId, cantidad);
}

test("un boleto con todas las patas acertadas se paga al liquidar", async () => {
    const u = `liq-${++n}`;
    const r = boleto(u, {
        legs: [
            [`cl-${n}-a`, "home"],
            [`cl-${n}-b`, "mas"],
        ],
    }); // 2 × 1,9 = 3,8
    expect(r.ok).toBe(true);
    const antes = dinero.efectivo(u);
    empezar(`cl-${n}-a`, `cl-${n}-b`);
    resultadosApi = { soccer_spain_la_liga: [score(`cl-${n}-a`, 2, 0), score(`cl-${n}-b`, 2, 1)] };

    const res = await liquidarApuestas({ minHorasDesdeInicio: 2 });

    expect(db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(r.id)).toEqual({ estado: "ganada", premio: 380 });
    expect(dinero.efectivo(u)).toBe(antes + 380);
    expect(res.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: u, premio: 380 })]));
});

test("una pata que falla hace perder el boleto al liquidar, aunque la otra acierte", async () => {
    const u = `liq-${++n}`;
    const r = boleto(u, {
        legs: [
            [`cl-${n}-a`, "away"],
            [`cl-${n}-b`, "menos"],
        ],
    });
    expect(r.ok).toBe(true);
    const antes = dinero.efectivo(u);
    empezar(`cl-${n}-a`, `cl-${n}-b`);
    resultadosApi = { soccer_spain_la_liga: [score(`cl-${n}-a`, 2, 0), score(`cl-${n}-b`, 1, 0)] };

    await liquidarApuestas({ minHorasDesdeInicio: 2 });

    expect(db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(r.id)).toEqual({ estado: "perdida", premio: 0 });
    expect(dinero.efectivo(u)).toBe(antes);
});

test("si un partido se queda sin resultado, la combinada se devuelve entera", async () => {
    const u = `liq-${++n}`;
    const id = `cl-${n}-viejo`;
    // El partido empezó hace más de 3 días: la API ya no da resultado y se caduca.
    const r = boleto(u, {
        legs: [
            [id, "home"],
            [`cl-${n}-otro`, "draw"],
        ],
    });
    expect(r.ok).toBe(true);
    const antes = dinero.efectivo(u);
    db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(hace(24 * 10), id);
    db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(hace(5), `cl-${n}-otro`);

    const res = await liquidarApuestas({ minHorasDesdeInicio: 2 });

    expect(db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(r.id)).toEqual({ estado: "reembolsada", premio: 100 });
    expect(dinero.efectivo(u)).toBe(antes + 100);
    expect(res.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: u, premio: 100, reembolso: true })]));
});
