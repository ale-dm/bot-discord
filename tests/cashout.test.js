// 💸 Cash-out anticipado (#529): el valor (cuota original, cuota actual y margen del 8 %), cuándo no se ofrece (sin cuota,
// cuota vieja, otra línea, partido cerrado, marcador exacto, combinada con una pata muerta), el bloqueo de 60 s, la cuota que se
// mueve más de un 10 %, el cobro una sola vez y que la liquidación ya no lo paga, el historial, «Mis jugadas» y sus
// estadísticas. BD en memoria y la Odds API simulada.
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const cashout = require("../src/systems/apuestas/cashout");
const misJugadas = require("../src/systems/apuestas/misJugadas");
const repoOdds = require("../src/repositorios/odds");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");
const panel = require("../src/paneles/misJugadas");

const AHORA = Date.now();
const fetchOriginal = global.fetch;
let n = 0;

function partido(id, { cuotas = {}, ts = AHORA, start = new Date(AHORA - 30 * 60 * 1000).toISOString(), estado = "abierto" } = {}) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
            cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea, cuotas_ts)
         VALUES (?, 'laliga', 'Local', 'Visitante', ?, ?, ?, ?, ?, 1.9, 1.9, 2.5, 2.2, 1.7, -1.5, ?)`,
    ).run(id, start, estado, cuotas.home ?? 1.5, cuotas.draw ?? 3.5, cuotas.away ?? 5, ts);
}
function apuesta(userId, matchId, { eleccion = "home", cantidad = 100, cuota = 2, linea = null } = {}) {
    return Number(
        db
            .prepare(
                "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, linea) VALUES (?, ?, ?, ?, ?, 0, ?)",
            )
            .run(userId, matchId, eleccion, cantidad, cuota, linea).lastInsertRowid,
    );
}
function combinada(userId, patas, { cantidad = 100 } = {}) {
    const cuota = Math.round(patas.reduce((p, x) => p * x.cuota, 1) * 100) / 100;
    const id = Number(
        db
            .prepare("INSERT INTO combinadas (user_id, cantidad, cuota, estado, creada_en) VALUES (?, ?, ?, 'abierta', ?)")
            .run(userId, cantidad, cuota, new Date(AHORA).toISOString()).lastInsertRowid,
    );
    for (const p of patas)
        db.prepare("INSERT INTO combinada_patas (combinada_id, match_id, eleccion, cuota, resultado) VALUES (?, ?, ?, ?, ?)").run(
            id,
            p.matchId,
            p.eleccion ?? "home",
            p.cuota,
            p.resultado ?? "pendiente",
        );
    return id;
}
const usuario = () => {
    const u = `co-${++n}`;
    dinero.pagar(u, 1000);
    return u;
};
const cambiarCuota = (matchId, home) => db.prepare("UPDATE apuestas_partidos SET cuota_home = ? WHERE match_id = ?").run(home, matchId);

beforeEach(() => {
    cashout._vaciarOfertas();
});

afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
});

describe("el valor (#529)", () => {
    test("lo apostado × cuota original ÷ cuota actual, menos el 8 %, sin decimales", () => {
        expect(cashout.valor(100, 2, 1.5)).toBe(122); // 133,33 × 0,92 = 122,66
        expect(cashout.valor(100, 2, 4)).toBe(46);
        expect(cashout.valor(100, 2, 2)).toBe(92);
    });

    test("tiene un tope de 1.000.000 y sin cuota no vale nada", () => {
        expect(cashout.valor(1_000_000, 50, 1.01)).toBe(cashout.MAX_VALOR);
        expect(cashout.valor(100, 2, null)).toBe(0);
        expect(cashout.valor(100, 2, 0.5)).toBe(0);
    });
});

describe("cuándo hay cuota para retirar (#529)", () => {
    const base = (extra = {}) => ({ estado: "abierto", cuotas_ts: AHORA, cuota_home: 1.5, total_linea: 2.5, cuota_mas: 1.9, ...extra });

    test("1X2 y mercados con la misma línea, con cuotas recientes", () => {
        expect(cashout.cuotaActual(base(), "home", AHORA)).toBe(1.5);
        expect(cashout.cuotaActual(base(), "mas", AHORA, 2.5)).toBe(1.9);
    });

    test.each([
        ["cuotas de hace más de 30 minutos", base({ cuotas_ts: AHORA - cashout.CUOTA_MAX_EDAD_MS - 1 }), "home"],
        ["sin fecha de cuotas", base({ cuotas_ts: null }), "home"],
        ["el partido ya terminó", base({ estado: "finalizado" }), "home"],
        ["mercado suspendido (sin cuota)", base({ cuota_home: null }), "home"],
        ["marcador exacto (sin cuota)", base(), "exacto_2-1"],
    ])("no hay con %s", (_caso, p, eleccion) => {
        expect(cashout.cuotaActual(p, eleccion, AHORA)).toBeNull();
    });

    test("con otra línea la cuota no es comparable", () => {
        expect(cashout.cuotaActual(base({ total_linea: 3.5 }), "mas", AHORA, 2.5)).toBeNull();
    });

    test("al guardar cuotas de la API se apunta cuándo", () => {
        repoOdds.guardarPartidos("laliga", [
            {
                m: { id: "co-ts", home_team: "A", away_team: "B", commence_time: new Date(AHORA + 3600e3).toISOString() },
                c: { home: 2, draw: 3, away: 4 },
                x: { cuota_mas: null, cuota_menos: null, total_linea: null, cuota_casa: null, cuota_fuera: null, hcap_linea: null },
            },
        ]);
        expect(db.prepare("SELECT cuotas_ts FROM apuestas_partidos WHERE match_id = 'co-ts'").get().cuotas_ts).toBeGreaterThanOrEqual(
            AHORA,
        );
    });
});

describe("retirar una apuesta (#529)", () => {
    test("se ofrece con su valor, se confirma y se cobra una sola vez, con historial", () => {
        const u = usuario();
        partido(`m-${n}`);
        const id = apuesta(u, `m-${n}`);
        const antes = dinero.efectivo(u);

        const [o] = cashout.retirables(u, AHORA);
        expect(o).toMatchObject({ tipo: "a", id, valor: 122 });
        const oferta = cashout.ofrecer(u, "a", id, AHORA);
        expect(oferta.expira).toBe(AHORA + cashout.BLOQUEO_MS);

        expect(cashout.confirmar(u, oferta.token, AHORA + 1000)).toMatchObject({ ok: true, valor: 122 });
        expect(dinero.efectivo(u)).toBe(antes + 122);
        expect(db.prepare("SELECT pagado, premio, retirada_en FROM apuestas_usuario WHERE id = ?").get(id)).toEqual({
            pagado: 1,
            premio: 122,
            retirada_en: AHORA + 1000,
        });
        expect(dinero.movimientos(u, { tipo: "apuestas" }).filas[0]).toMatchObject({
            descripcion: "Cash-out: Local vs Visitante",
            cantidad: 122,
        });

        expect(cashout.confirmar(u, oferta.token, AHORA + 2000).ok).toBe(false);
        expect(cashout.retirables(u, AHORA)).toEqual([]);
        expect(dinero.efectivo(u)).toBe(antes + 122);
    });

    test("dos ofertas a la vez de la misma apuesta solo cobran una", () => {
        const u = usuario();
        partido(`m-${n}`);
        const id = apuesta(u, `m-${n}`);
        const antes = dinero.efectivo(u);
        const a = cashout.ofrecer(u, "a", id, AHORA);
        const b = cashout.ofrecer(u, "a", id, AHORA);
        expect(cashout.confirmar(u, a.token, AHORA).ok).toBe(true);
        expect(cashout.confirmar(u, b.token, AHORA)).toMatchObject({ ok: false });
        expect(dinero.efectivo(u)).toBe(antes + 122);
    });

    test("pasados 60 segundos no se cobra y se ofrece otra vez", () => {
        const u = usuario();
        partido(`m-${n}`);
        const id = apuesta(u, `m-${n}`);
        const o = cashout.ofrecer(u, "a", id, AHORA);
        const r = cashout.confirmar(u, o.token, AHORA + cashout.BLOQUEO_MS);
        expect(r).toMatchObject({ ok: false, motivo: "La oferta ha caducado (60 s).", nueva: { ok: true, valor: 122 } });
        expect(db.prepare("SELECT pagado FROM apuestas_usuario WHERE id = ?").get(id).pagado).toBe(0);
    });

    test("si la cuota se mueve más de un 10 % se invalida y se recalcula; si se mueve poco, vale el valor bloqueado", () => {
        const u = usuario();
        partido(`m-${n}`);
        const id = apuesta(u, `m-${n}`);
        const o = cashout.ofrecer(u, "a", id, AHORA);
        cambiarCuota(`m-${n}`, 1.2); // −20 %
        const r = cashout.confirmar(u, o.token, AHORA);
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe("La cuota se ha movido.");
        expect(r.nueva.valor).toBe(cashout.valor(100, 2, 1.2));

        cambiarCuota(`m-${n}`, 1.25); // ~4 % respecto a la nueva oferta
        const antes = dinero.efectivo(u);
        expect(cashout.confirmar(u, r.nueva.token, AHORA)).toMatchObject({ ok: true, valor: cashout.valor(100, 2, 1.2) });
        expect(dinero.efectivo(u)).toBe(antes + cashout.valor(100, 2, 1.2));
    });

    test("si el mercado se suspende entre ofrecer y confirmar, no se cobra", () => {
        const u = usuario();
        partido(`m-${n}`);
        const id = apuesta(u, `m-${n}`);
        const o = cashout.ofrecer(u, "a", id, AHORA);
        cambiarCuota(`m-${n}`, null);
        expect(cashout.confirmar(u, o.token, AHORA)).toMatchObject({ ok: false, nueva: null });
        expect(db.prepare("SELECT pagado FROM apuestas_usuario WHERE id = ?").get(id).pagado).toBe(0);
    });

    test("la oferta de otra persona no se puede confirmar", () => {
        const u = usuario();
        partido(`m-${n}`);
        const o = cashout.ofrecer(u, "a", apuesta(u, `m-${n}`), AHORA);
        expect(cashout.confirmar("otra", o.token, AHORA).ok).toBe(false);
        expect(cashout.ofrecer("otra", "a", o.id, AHORA)).toMatchObject({ ok: false });
    });

    test("sin cuota actual, con cuotas viejas o al marcador exacto no se ofrece", () => {
        const u = usuario();
        partido(`m-${n}-viejo`, { ts: AHORA - 2 * 3600e3 });
        apuesta(u, `m-${n}-viejo`);
        partido(`m-${n}-exacto`);
        apuesta(u, `m-${n}-exacto`, { eleccion: "exacto_2-1", cuota: 8 });
        expect(cashout.retirables(u, AHORA)).toEqual([]);
    });

    test("una vez retirada, la liquidación no la vuelve a pagar", async () => {
        const u = usuario();
        const m = `m-${n}`;
        partido(m, { start: new Date(AHORA - 5 * 3600e3).toISOString() });
        const id = apuesta(u, m);
        const otro = usuario();
        apuesta(otro, m); // otra apuesta pendiente al mismo partido: la liquidación tiene que pasar por él
        cashout.confirmar(u, cashout.ofrecer(u, "a", id, AHORA).token, AHORA);
        const antes = dinero.efectivo(u);
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: new Map([["x-requests-remaining", "400"]]),
            json: async () => [
                {
                    id: m,
                    completed: true,
                    home_team: "Local",
                    away_team: "Visitante",
                    scores: [
                        { name: "Local", score: "3" },
                        { name: "Visitante", score: "0" },
                    ],
                },
            ],
        }));
        await liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(db.prepare("SELECT estado FROM apuestas_partidos WHERE match_id = ?").get(m).estado).toBe("finalizado");
        expect(dinero.efectivo(u)).toBe(antes);
        expect(db.prepare("SELECT premio FROM apuestas_usuario WHERE id = ?").get(id).premio).toBe(122);
    });
});

describe("retirar una combinada (#529)", () => {
    test("con una pata acertada y otra viva: las acertadas cuentan con cuota 1", () => {
        const u = usuario();
        partido(`c-${n}-a`);
        partido(`c-${n}-b`, { cuotas: { home: 1.25 } });
        const id = combinada(u, [
            { matchId: `c-${n}-a`, cuota: 2, resultado: "acierta" },
            { matchId: `c-${n}-b`, cuota: 2.5 },
        ]);
        const o = cashout.ofrecer(u, "c", id, AHORA);
        expect(o.valor).toBe(cashout.valor(100, 5, 1.25)); // 100 × 5 ÷ 1,25 × 0,92 = 368
        const antes = dinero.efectivo(u);
        expect(cashout.confirmar(u, o.token, AHORA).ok).toBe(true);
        expect(dinero.efectivo(u)).toBe(antes + 368);
        expect(db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(id)).toEqual({ estado: "retirada", premio: 368 });
    });

    test("si alguna pata ya ha fallado o no tiene cuota, no se ofrece", () => {
        const u = usuario();
        partido(`c-${n}-a`);
        partido(`c-${n}-b`);
        const muerta = combinada(u, [
            { matchId: `c-${n}-a`, cuota: 2, resultado: "falla" },
            { matchId: `c-${n}-b`, cuota: 2 },
        ]);
        expect(cashout.ofrecer(u, "c", muerta, AHORA).motivo).toContain("pata fallada");
        cambiarCuota(`c-${n}-b`, null);
        const sinCuota = combinada(u, [
            { matchId: `c-${n}-a`, cuota: 2 },
            { matchId: `c-${n}-b`, cuota: 2 },
        ]);
        expect(cashout.ofrecer(u, "c", sinCuota, AHORA).ok).toBe(false);
    });
});

describe("«Mis jugadas» (#529)", () => {
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
    const interaccion = (customId, userId, extra = {}) => ({
        customId,
        user: { id: userId },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });

    test("⏳ En juego ofrece retirar, sin pasar de 5 filas", () => {
        const u = usuario();
        partido(`p-${n}`);
        apuesta(u, `p-${n}`);
        const p = panel.buildMisJugadas(u, "activas");
        expect(p.components.length).toBeLessThanOrEqual(5);
        const menu = p.components.flatMap((f) => f.toJSON().components).find((c) => c.custom_id === `misapuestas_cashsel_${u}`);
        expect(menu.options[0].description).toContain("→ 122 🪙");
    });

    test("elegir, confirmar y cobrar desde los botones; otra persona no puede", async () => {
        const u = usuario();
        partido(`p-${n}`);
        const id = apuesta(u, `p-${n}`);
        const sel = interaccion(`misapuestas_cashsel_${u}`, u, { values: [`a${id}`] });
        await panel.handleCashoutSelect({}, sel);
        const confirmar = ids(sel.update.mock.calls[0][0]).find((c) => c.startsWith("misapuestas_cashok_"));
        expect(confirmar).toMatch(new RegExp(`^misapuestas_cashok_[0-9a-f]{12}_${u}$`));

        const ajena = interaccion(confirmar.replace(new RegExp(`_${u}$`), "_otro"), "otro");
        await panel.handleButton({}, ajena);
        expect(db.prepare("SELECT pagado FROM apuestas_usuario WHERE id = ?").get(id).pagado).toBe(0);

        const ok = interaccion(confirmar, u);
        await panel.handleButton({}, ok);
        expect(ok.update.mock.calls[0][0].content).toContain("💸 Retirada por **122**");
        expect(db.prepare("SELECT pagado FROM apuestas_usuario WHERE id = ?").get(id).pagado).toBe(1);
    });

    test("la retirada deja de estar en juego, sale en resueltas y cuenta en las estadísticas", () => {
        const u = usuario();
        partido(`p-${n}`);
        const id = apuesta(u, `p-${n}`);
        cashout.confirmar(u, cashout.ofrecer(u, "a", id, AHORA).token, AHORA);
        expect(misJugadas.partidosDe(u, { pendientes: true })).toEqual([]);
        expect(misJugadas.partidosDe(u, { pendientes: false })[0]).toMatchObject({ id, retirada_en: AHORA });
        expect(misJugadas.estadisticas(u).partidos).toMatchObject({ ganadas: 1, pendientes: 0, apostado: 100, ganado: 122, enJuego: 0 });
        const historial = panel.buildMisJugadas(u, "historial").embeds[0].data.fields[0].value;
        expect(historial).toContain("💸 Retirada (+122)");
    });
});
