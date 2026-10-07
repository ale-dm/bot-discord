// Cartera de apuestas (F-AP-04, issue #3): en 📋 Mis jugadas → ⏳ En juego, el total en juego, el posible premio de los
// partidos pendientes y el beneficio del mes (en hora de Madrid), con apuestas reales en la BD (en memoria).
const db = require("../src/core/db");
const jugadas = require("../src/systems/apuestas/misJugadas");
const { buildMisJugadas } = require("../src/paneles/misJugadas");

// 15 de octubre de 2026, mediodía.
const AHORA = Date.UTC(2026, 9, 15, 12);
let n = 0;

function apuesta(userId, { cantidad, cuota = 2, premio = null, inicio, estado = "finalizado", eleccion = "home", matchId = null }) {
    const id = matchId || `ct-${++n}`;
    db.prepare(
        "INSERT OR IGNORE INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES (?, 'Local', 'Visitante', ?, ?, 'laliga', 2, 3, 4)",
    ).run(id, inicio, estado);
    db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, id, eleccion, cantidad, cuota, estado === "abierto" ? 0 : 1, premio);
    return id;
}

function quiniela(estado, cerradaEn, jugadas_) {
    const id = db
        .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES ('laliga', 'J', ?, ?, ?)")
        .run(estado, "2026-09-01T10:00:00.000Z", cerradaEn).lastInsertRowid;
    for (const [userId, cantidad, premio] of jugadas_) {
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, ?, '1', ?, ?, ?, ?)",
        ).run(id, userId, cantidad, premio, estado === "abierta" ? 0 : 1, "2026-09-01T10:00:00.000Z");
    }
}

// En juego: un partido con dos apuestas (a local y a empate: solo puede acertar una) y otro con una; y una quiniela.
const m1 = apuesta("ana", { cantidad: 100, cuota: 2, inicio: "2026-10-20T18:00:00.000Z", estado: "abierto" });
apuesta("ana", { cantidad: 50, cuota: 3.5, inicio: "2026-10-20T18:00:00.000Z", estado: "abierto", eleccion: "draw", matchId: m1 });
apuesta("ana", { cantidad: 80, cuota: 2.5, inicio: "2026-10-21T18:00:00.000Z", estado: "abierto" });
quiniela("abierta", null, [["ana", 30, 0]]);

// Resueltas en octubre (hora de Madrid): +200, -50 y -20 (el 30 de septiembre a las 22:30 UTC ya es 1 de octubre en Madrid).
apuesta("ana", { cantidad: 100, cuota: 3, premio: 300, inicio: "2026-10-02T18:00:00.000Z" });
apuesta("ana", { cantidad: 50, premio: 0, inicio: "2026-10-10T18:00:00.000Z" });
apuesta("ana", { cantidad: 20, premio: 0, inicio: "2026-09-30T22:30:00.000Z" });
// Del mes pasado (23:30 del 30 de septiembre en Madrid): no cuenta.
apuesta("ana", { cantidad: 10, cuota: 100, premio: 1000, inicio: "2026-09-30T21:30:00.000Z" });
// Reembolsada por falta de resultado: no es ni beneficio ni pérdida.
apuesta("ana", { cantidad: 40, premio: 40, inicio: "2026-10-05T18:00:00.000Z", estado: "caducado" });
// Quinielas cerradas en octubre: una sin premio (ganó otro: -30) y una caducada (se devolvió: 0). Una de septiembre, fuera.
quiniela("cerrada", "2026-10-05T20:00:00.000Z", [
    ["ana", 30, 0],
    ["luis", 30, 54],
]);
quiniela("caducada", "2026-10-08T20:00:00.000Z", [["ana", 25, 0]]);
quiniela("cerrada", "2026-09-28T20:00:00.000Z", [["ana", 30, 500]]);

test("total en juego, posible premio (lo máximo por partido) y beneficio del mes en hora de Madrid", () => {
    expect(jugadas.cartera("ana", AHORA)).toEqual({
        enJuego: 100 + 50 + 80 + 30,
        partidos: 2,
        quinielas: 1,
        // En el primer partido, la de más premio (100 × 2 = 200 frente a 50 × 3,5 = 175); en el segundo, 80 × 2,5 = 200.
        posiblePremio: 400,
        beneficioMes: 200 - 50 - 20 - 30,
        resueltasMes: 5,
        mes: "octubre",
    });
    // En noviembre, lo de octubre ya no es "del mes".
    expect(jugadas.cartera("ana", Date.UTC(2026, 10, 2, 12))).toMatchObject({ beneficioMes: 0, resueltasMes: 0, mes: "noviembre" });
    expect(jugadas.cartera("nadie", AHORA)).toEqual({
        enJuego: 0,
        partidos: 0,
        quinielas: 0,
        posiblePremio: 0,
        beneficioMes: 0,
        resueltasMes: 0,
        mes: "octubre",
    });
});

describe("📋 Mis jugadas → ⏳ En juego enseña la cartera", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(AHORA));
    afterEach(() => jest.restoreAllMocks());

    test("con apuestas", () => {
        const embed = buildMisJugadas("ana", "activas").embeds[0].data;
        expect(embed.description).toBe(
            "💰 En juego: **260** 🪙 (2 partidos y 1 quiniela)\n" +
                "🏆 Posible premio: **400** 🪙 si aciertas tus partidos (sin la quiniela, que depende del bote)\n" +
                "📅 Beneficio de octubre: **+100** 🪙 en 5 apuestas resueltas",
        );
    });

    test("sin nada apostado", () => {
        const embed = buildMisJugadas("nadie", "activas").embeds[0].data;
        expect(embed.description).toBe("💰 En juego: **0** 🪙\n📅 Beneficio de octubre: nada resuelto todavía");
    });
});

test('con marcador exacto, el posible premio de un partido suma lo que puede ganar a la vez (el 2-1 y "gana el local")', () => {
    const { maximoDelPartido } = jugadas;
    const a = (eleccion, cantidad, cuota) => ({ eleccion, cantidad, cuota });
    // Local 200, empate 150; 2-1 (gana el local) 800 y 1-1 (empate) 400. Lo mejor: el 2-1, con lo del local → 1.000.
    expect(maximoDelPartido([a("home", 100, 2), a("draw", 50, 3), a("exacto_2-1", 100, 8), a("exacto_1-1", 50, 8)])).toBe(1000);
    // Un marcador que no casa con el resultado apostado no se suma: 0-2 (gana el visitante) 400 frente a local 200.
    expect(maximoDelPartido([a("home", 100, 2), a("exacto_0-2", 50, 8)])).toBe(400);
    // Sin marcadores, como antes: solo uno de 1/X/2 puede salir.
    expect(maximoDelPartido([a("home", 100, 2), a("draw", 50, 3.5)])).toBe(200);
});
