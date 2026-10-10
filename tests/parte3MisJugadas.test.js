// Parte 3 del plan de paneles: Mis jugadas (partidos y quinielas juntos) y la quiniela enseñando tus
// pronósticos con aciertos (E-08). /misapuestas edita el mensaje en vez de crear otro (E-13).
const db = require("../src/core/db");
const jugadas = require("../src/systems/apuestas/misJugadas");
const misapuestas = require("../src/paneles/misJugadas");
const juegos = require("../src/commands/juegos/juegos");
const quiniela = require("../src/juegos/apuestas/quiniela");
const apuestas = require("../src/juegos/apuestas/apuestas");

const futuro = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const pasado = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// Quiniela abierta de LaLiga con 4 partidos: los dos primeros ya jugados (1 y X).
const qAbierta = db
    .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', 'Jornada 40', 'abierta', ?)")
    .run(pasado(48)).lastInsertRowid;
const partidoQ = db.prepare(
    "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time, resultado_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
partidoQ.run(qAbierta, "qa-1", 1, "Betis", "Sevilla", pasado(30), "home");
partidoQ.run(qAbierta, "qa-2", 2, "Real", "Barça", pasado(28), "draw");
partidoQ.run(qAbierta, "qa-3", 3, "Valencia", "Getafe", futuro(20), null);
partidoQ.run(qAbierta, "qa-4", 4, "Osasuna", "Girona", futuro(22), null);
const apostarQ = db.prepare(
    "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
apostarQ.run(qAbierta, "ana", "12X1", 100, 0, 0, pasado(50)); // acierta la 1.ª, falla la 2.ª

// Quiniela cerrada en la que nadie llegó al mínimo: se devolvió lo apostado (premio 0 para todos).
const qDevuelta = db
    .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', 'Jornada 39', 'cerrada', ?)")
    .run(pasado(200)).lastInsertRowid;
partidoQ.run(qDevuelta, "qd-1", 1, "A", "B", pasado(190), "away");
apostarQ.run(qDevuelta, "ana", "1", 50, 0, 1, pasado(195));

// Un partido suelto pendiente.
db.prepare(
    "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES ('m-p3', 'Celta', 'Alavés', ?, 'abierto', 'laliga', 2, 3, 4)",
).run(futuro(10));
db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('ana', 'm-p3', 'home', 80, 2)").run();
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('ana', 0, 1000)").run();

const interaccion = (extra = {}) => ({
    user: { id: "ana", tag: "ana" },
    guildId: "g",
    memberPermissions: { has: () => false },
    options: { getString: () => null },
    isButton: () => Boolean(extra.customId),
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    ...extra,
});
const texto = (payload) => JSON.stringify(payload.embeds.map((e) => e.data));
const ids = (payload) => payload.components.flatMap((r) => r.components.map((b) => b.data.custom_id));

test("el detalle de una quiniela marca aciertos solo en los partidos jugados", () => {
    const d = jugadas.detalleQuiniela(qAbierta, "12X1");
    expect(d.lineas.map((l) => l.acierto)).toEqual([true, false, null, null]);
    expect(d).toMatchObject({ aciertos: 1, jugados: 2, total: 4 });
});

test("/quiniela, si ya has apostado, enseña tus pronósticos y el botón de Mis jugadas (E-08)", async () => {
    const i = interaccion();
    await quiniela.run(null, i);
    const payload = i.reply.mock.calls[0][0];
    expect(texto(payload)).toMatch(/Tu quiniela \(100/);
    expect(texto(payload)).toMatch(/1✅ 2❌ X⏳ 1⏳/);
    expect(ids(payload).slice(0, 3)).toEqual(["misapuestas_activas_ana", "quiniela_refrescar_laliga", "apuestas_pagina_laliga_1"]);
    // Y debajo, las pestañas de /juegos.
    expect(ids(payload).slice(3)).toEqual(["juegos_casino", "juegos_apuestas_laliga", "juegos_retos", "juegos_jugadas", "juegos_stats"]);

    const otro = interaccion({ user: { id: "luis" } });
    await quiniela.run(null, otro);
    expect(ids(otro.reply.mock.calls[0][0])[0]).toBe(`quiniela_apostar_${qAbierta}`);
});

test("Mis jugadas junta partidos y quinielas, y los botones editan el mensaje (E-13)", async () => {
    const i = interaccion({ options: { getString: () => "jugadas" } });
    await juegos.run(null, i);
    const enJuego = i.reply.mock.calls[0][0];
    expect(texto(enJuego)).toMatch(/Celta/);
    expect(texto(enJuego)).toMatch(/Jornada 40/);

    const stats = interaccion({ customId: "misapuestas_stats_ana" });
    await misapuestas.handleButton(null, stats);
    expect(stats.reply).not.toHaveBeenCalled();
    const payload = stats.update.mock.calls[0][0];
    // La quiniela devuelta cuenta como recuperada, no como perdida.
    expect(texto(payload)).toMatch(/\*\*50\*\* apostado en las cerradas → \*\*50\*\* cobrado o devuelto \(\+0\)/);
    expect(ids(payload)).toContain("juegos_jugadas"); // Stats ya tiene botones para volver

    const intruso = interaccion({ customId: "misapuestas_stats_ana", user: { id: "luis" } });
    await misapuestas.handleButton(null, intruso);
    expect(intruso.update).not.toHaveBeenCalled();
});

test("/apuestas: Mis jugadas se abre en el mismo mensaje, y tras apostar hay botones para seguir", async () => {
    const ver = interaccion({ customId: "ver_mis_apuestas" });
    await apuestas.handleButton({}, ver);
    expect(texto(ver.update.mock.calls[0][0])).toMatch(/Lo que tienes en juego/);

    const modal = interaccion({ customId: "apuestas_modal_away_m-p3", fields: { getTextInputValue: () => "50" } });
    await apuestas.handleModal(null, modal);
    expect(ids(modal.reply.mock.calls[0][0])).toEqual(["misapuestas_activas_ana", "apuestas_pagina_laliga_1"]);
});
