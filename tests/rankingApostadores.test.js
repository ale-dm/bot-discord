// Ranking de apostadores (F-AP-03, issue #2): beneficio, % de acierto y mejor racha, con apuestas reales en la BD (en
// memoria) y la pantalla de /perfil → 🏆 Rankings → ⚽ Apostadores.
const db = require("../src/core/db");
const ranking = require("../src/systems/apuestas/ranking");
const perfil = require("../src/commands/progresion/perfil");

const dia = (n) => new Date(Date.UTC(2026, 8, n, 18)).toISOString();
let partidos = 0;

/** Un partido ya jugado (o en otro estado) con una apuesta de `userId`. premio: lo cobrado (0 = perdida). */
function apuesta(userId, { cantidad, cuota = 2, premio, inicio, estado = "finalizado" }) {
    const matchId = `rk-${++partidos}`;
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, resultado) VALUES (?, 'Local', 'Visitante', ?, ?, 'laliga', 'home')",
    ).run(matchId, inicio, estado);
    db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES (?, ?, 'home', ?, ?, ?, ?)",
    ).run(userId, matchId, cantidad, cuota, estado === "abierto" ? 0 : 1, premio);
}

function quiniela(estado, jugadas) {
    const id = db
        .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', 'J', ?, ?)")
        .run(estado, dia(1)).lastInsertRowid;
    for (const [userId, cantidad, premio] of jugadas) {
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, ?, '1', ?, ?, 1, ?)",
        ).run(id, userId, cantidad, premio, dia(1));
    }
}

// ana: por orden de partido G G G P G P (racha de 3). Insertadas desordenadas: por id serían G P G G P G (racha de 2),
// para ver que la racha va por la fecha del partido y no por el orden en que se apostó.
apuesta("ana", { cantidad: 100, cuota: 2, premio: 200, inicio: dia(1) });
apuesta("ana", { cantidad: 100, premio: 0, inicio: dia(4) });
apuesta("ana", { cantidad: 100, cuota: 3, premio: 300, inicio: dia(2) });
apuesta("ana", { cantidad: 50, premio: 100, inicio: dia(5) });
apuesta("ana", { cantidad: 50, premio: 0, inicio: dia(6) });
apuesta("ana", { cantidad: 50, premio: 100, inicio: dia(3) });
// Lo pendiente y lo reembolsado (caducado) no cuentan ni para el beneficio ni para el acierto.
apuesta("ana", { cantidad: 80, premio: null, inicio: dia(28), estado: "abierto" });
apuesta("ana", { cantidad: 30, premio: 30, inicio: dia(7), estado: "caducado" });

// marta: 2 partidos (G P) y 3 quinielas: una con premio, una sin premio (otro ganó) y una caducada (se le devolvió).
apuesta("marta", { cantidad: 100, cuota: 1.5, premio: 150, inicio: dia(8) });
apuesta("marta", { cantidad: 100, premio: 0, inicio: dia(9) });
quiniela("cerrada", [["marta", 100, 500]]);
quiniela("cerrada", [
    ["marta", 100, 0],
    ["xavi", 100, 180],
]);
quiniela("caducada", [["marta", 100, 0]]);

// luis: 5 perdidas. pepe: solo 4 resueltas (no llega al mínimo).
for (let n = 10; n < 15; n++) apuesta("luis", { cantidad: 20, premio: 0, inicio: dia(n) });
for (let n = 10; n < 14; n++) apuesta("pepe", { cantidad: 1000, cuota: 5, premio: 5000, inicio: dia(n) });

test("beneficio, acierto y mejor racha de cada uno", () => {
    expect(ranking.cifras("ana")).toEqual({
        userId: "ana",
        // apostado 450 en las resueltas, cobrado 700
        beneficio: 250,
        resueltas: 6,
        ganadas: 4,
        perdidas: 2,
        acierto: (4 / 6) * 100,
        racha: 3,
    });
    // Partidos: -50 (150 de 200). Quinielas: +500 de la ganada, 0 de la perdida y los 100 devueltos de la caducada → +300.
    expect(ranking.cifras("marta")).toMatchObject({ beneficio: 250, resueltas: 5, acierto: 50, racha: 1 });
    expect(ranking.cifras("luis")).toMatchObject({ beneficio: -100, resueltas: 5, acierto: 0, racha: 0 });
    expect(ranking.cifras("xavi")).toMatchObject({ beneficio: 80, resueltas: 1, acierto: null, racha: 0 });
});

test("ordenado por beneficio (a igualdad, más acierto) y sin quien no llega al mínimo de apuestas resueltas", () => {
    expect(ranking.ranking().map((c) => c.userId)).toEqual(["ana", "marta", "luis"]);
    expect(ranking.ranking({ minimo: 1 }).map((c) => c.userId)).toEqual(["pepe", "ana", "marta", "xavi", "luis"]);
    expect(ranking.ranking({ limite: 1 }).map((c) => c.userId)).toEqual(["ana"]);
});

test("/perfil → 🏆 Rankings → ⚽ Apostadores", async () => {
    const guild = { id: "g-rk", name: "Servidor", members: { cache: new Map(), fetch: async () => null }, iconURL: () => null };
    const i = {
        guild,
        guildId: guild.id,
        user: { id: "ana", username: "ana", tag: "ana" },
        customId: "perfil_ranksel_ana_ana",
        values: ["apuestas"],
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    };
    await perfil.handleSelect(null, i);
    expect(i.reply).not.toHaveBeenCalled();
    const payload = i.update.mock.calls[0][0];
    const embed = payload.embeds[0].data;
    expect(embed.title).toBe("⚽ Ranking de apostadores");
    const lineas = embed.description.split("\n");
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toBe("🥇 <@ana> — **+250** 🪙 · 66,7 % de acierto · 🔥 3 seguidas");
    expect(lineas[1]).toBe("🥈 <@marta> — **+250** 🪙 · 50 % de acierto");
    expect(lineas[2]).toBe("🥉 <@luis> — **-100** 🪙 · 0 % de acierto");
    // El menú tiene la opción, marcada.
    const menu = payload.components[0].toJSON().components[0];
    expect(menu.options.find((o) => o.value === "apuestas")).toMatchObject({ label: "⚽ Apostadores", default: true });
});
