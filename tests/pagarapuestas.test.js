// Liquidación de apuestas con la Odds API simulada (no se hace ninguna petición real).
process.env.ODDS_API_KEY = "clave-de-prueba";

const db = require("../src/core/db");
const { liquidarApuestas } = require("../src/commands/apuestas/pagarapuestas");

const hace = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
const saldo = (id) => db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(id)?.saldo;

// Resultados que "devuelve" la API, por deporte.
let resultadosApi = {};
let llamadas = [];
beforeEach(() => {
    llamadas = [];
    global.fetch = jest.fn(async (url) => {
        const deporte = /sports\/([^/]+)\/scores/.exec(url)[1];
        llamadas.push(deporte);
        expect(url).toMatch(/daysFrom=3/);
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

function partido(match_id, horasDesdeInicio, deporte = "laliga") {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, deporte) VALUES (?, 'Local', 'Visitante', ?, ?)`,
    ).run(match_id, hace(horasDesdeInicio), deporte);
}
function apuesta(userId, match_id, eleccion, cantidad, cuota = 2) {
    db.prepare("INSERT OR IGNORE INTO banco (userId, saldo) VALUES (?, 0)").run(userId);
    db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES (?, ?, ?, ?, ?)").run(
        userId,
        match_id,
        eleccion,
        cantidad,
        cuota,
    );
}

test("paga las ganadoras, marca las perdidas y guarda el premio de cada una", async () => {
    partido("m-reciente", 5);
    apuesta("gana", "m-reciente", "home", 100, 2.5);
    apuesta("pierde", "m-reciente", "away", 100);
    resultadosApi = { soccer_spain_la_liga: [score("m-reciente", 2, 1)] };

    const r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.pagadas).toBe(1);
    expect(r.fallidas).toBe(1);
    expect(saldo("gana")).toBe(250);
    expect(saldo("pierde")).toBe(0);
    const premios = db.prepare("SELECT user_id, premio FROM apuestas_usuario WHERE match_id = 'm-reciente' ORDER BY user_id").all();
    expect(premios).toEqual([
        { user_id: "gana", premio: 250 },
        { user_id: "pierde", premio: 0 },
    ]);
    expect(db.prepare("SELECT estado, resultado FROM apuestas_partidos WHERE match_id = 'm-reciente'").get()).toEqual({
        estado: "finalizado",
        resultado: "home",
    });
});

test("un partido de hace más de 3 días sin resultado se caduca y se devuelve lo apostado, sin llamar a la API", async () => {
    partido("m-viejo", 24 * 10, "champions");
    apuesta("viejo", "m-viejo", "home", 200);

    const r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.caducados).toBe(1);
    expect(r.reembolsos).toBe(1);
    expect(saldo("viejo")).toBe(200);
    expect(db.prepare("SELECT estado FROM apuestas_partidos WHERE match_id = 'm-viejo'").get().estado).toBe("caducado");
    expect(r.pagos).toEqual([expect.objectContaining({ userId: "viejo", premio: 200, reembolso: true })]);
    expect(llamadas).not.toContain("soccer_uefa_champs_league");
});

test("un partido terminado sin apuestas no se consulta a la API", async () => {
    partido("m-sin-apuestas", 5);
    await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(llamadas).toEqual([]);
});

test("sin partidos en la ventana no se gasta cuota", async () => {
    partido("m-futuro", -24); // empieza mañana
    await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(llamadas).toEqual([]);
});

test("una quiniela se completa aunque sus partidos no estén todos a la vez en la API", async () => {
    const q = db.prepare("INSERT INTO quinielas (deporte, jornada, creada_en) VALUES ('laliga', 'J1', ?)").run(hace(100)).lastInsertRowid;
    const p = (id, orden, horas) =>
        db
            .prepare(
                "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(q, id, orden, "L", "V", hace(horas));
    p("q1", 1, 60); // viernes
    p("q2", 2, 30); // domingo
    db.prepare("INSERT OR IGNORE INTO banco (userId, saldo) VALUES (?, 0)").run("quinielista");
    db.prepare(
        "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, 'quinielista', '12', 100, ?)",
    ).run(q, hace(90));

    // Primera pasada: la API solo tiene el primer partido.
    resultadosApi = { soccer_spain_la_liga: [score("q1", 1, 0)] };
    let r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.quinielasCerradas).toBe(0);
    // Segunda pasada (días después): el primero ya no sale en la API, pero quedó guardado.
    resultadosApi = { soccer_spain_la_liga: [score("q2", 0, 3)] };
    r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.quinielasCerradas).toBe(1);
    expect(saldo("quinielista")).toBe(90); // único jugador: se lleva el 90 % del bote
});

function quinielaTerminada(jornada, resultados) {
    const q = db
        .prepare("INSERT INTO quinielas (deporte, jornada, creada_en) VALUES ('laliga', ?, ?)")
        .run(jornada, hace(100)).lastInsertRowid;
    resultados.forEach((r, i) =>
        db
            .prepare(
                "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time, resultado_final) VALUES (?, ?, ?, 'L', 'V', ?, ?)",
            )
            .run(q, `${jornada}-${i}`, i + 1, hace(30), r),
    );
    return q;
}
function jugarQuiniela(q, userId, predicciones, cantidad) {
    db.prepare("INSERT OR IGNORE INTO banco (userId, saldo) VALUES (?, 0)").run(userId);
    db.prepare("INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, ?, ?, ?, ?)").run(
        q,
        userId,
        predicciones,
        cantidad,
        hace(90),
    );
}

test("en la quiniela solo cobra quien acierta al menos la mitad", async () => {
    // Resultados: 1 1 1 1 → mínimo 2 aciertos.
    const q = quinielaTerminada("J-min", ["home", "home", "home", "home"]);
    jugarQuiniela(q, "q-bueno", "11XX", 100); // 2 aciertos
    jugarQuiniela(q, "q-malo", "1XXX", 100); // 1 acierto

    const r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.quinielasCerradas).toBe(1);
    expect(saldo("q-bueno")).toBe(180);
    expect(saldo("q-malo")).toBe(0);
});

test("si nadie llega al mínimo de aciertos, la quiniela devuelve lo apostado", async () => {
    const q = quinielaTerminada("J-nadie", ["home", "home", "home", "home"]);
    jugarQuiniela(q, "q-solo", "2222", 150); // 0 aciertos: antes recuperaba el 90 %
    jugarQuiniela(q, "q-otro", "1XXX", 50); // 1 acierto: antes se llevaba todo el fondo

    const r = await liquidarApuestas({ minHorasDesdeInicio: 2 });
    expect(r.quinielasCerradas).toBe(1);
    expect(saldo("q-solo")).toBe(150);
    expect(saldo("q-otro")).toBe(50);
    expect(r.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "q-solo", premio: 150, reembolso: true })]));
    expect(db.prepare("SELECT premio FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = 'q-solo'").get(q).premio).toBe(0);
});
