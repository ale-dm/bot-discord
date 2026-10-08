// Parte 4 del plan de paneles: /juegos junta casino y apuestas en pestañas, y sustituye a 8 comandos.
jest.mock("../src/services/oddsApi", () => ({
    ...jest.requireActual("../src/services/oddsApi"),
    sincronizarPartidos: jest.fn(async () => [{ id: "m-p4" }]),
}));
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const juegos = require("../src/commands/juegos/juegos");

const futuro = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
db.prepare(
    "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES ('m-p4', 'Arsenal', 'Chelsea', ?, 'abierto', 'premier', 2, 3, 4)",
).run(futuro);

const interaccion = (extra = {}) => ({
    user: { id: "u4", username: "u4" },
    guildId: "g4",
    message: { interaction: { user: { id: "u4" } } },
    memberPermissions: { has: () => false },
    options: { getString: () => null },
    isButton: () => Boolean(extra.customId),
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    ...extra,
});
const pestanas = (payload) => payload.components.at(-1).components.map((b) => [b.data.custom_id, b.data.style]);
const PESTANAS = ["juegos_casino", "juegos_apuestas_laliga", "juegos_retos", "juegos_jugadas", "juegos_stats"];

test.each([
    ["casino", "🎰 Casino — Tu resumen", 0],
    ["retos", "⚔️ Retos", 2],
    ["jugadas", "⏳ Lo que tienes en juego", 3],
    ["stats", "📊 Estadísticas de u4", 4],
])("/juegos seccion:%s abre su pestaña, con la fila de pestañas y la actual resaltada", async (seccion, titulo, actual) => {
    const i = interaccion({ options: { getString: () => seccion } });
    await juegos.run(null, i);
    const payload = i.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe(titulo);
    const fila = pestanas(payload);
    expect(fila.map(([id]) => id)).toEqual(PESTANAS);
    expect(fila.map(([, style]) => style)).toEqual(PESTANAS.map((_, n) => (n === actual ? 1 : 2))); // 1 = Primary
});

test("la pestaña Apuestas lista los partidos, deja cambiar de competición y tiene la quiniela", async () => {
    const i = interaccion({ customId: "juegos_apuestas_premier" });
    await juegos.handleButton(null, i);
    const payload = i.update.mock.calls[0][0];
    expect(JSON.stringify(payload.components[0].toJSON())).toMatch(/Arsenal/);
    // Las competiciones van en filas de 5 botones (con 7 competiciones, dos filas), entre el buscador y las pestañas.
    const competiciones = payload.components.slice(1, -1).flatMap((fila) => fila.components.map((b) => b.data.custom_id));
    expect(competiciones).toEqual([
        "apuestas_pagina_laliga_1",
        "apuestas_pagina_premier_1",
        "apuestas_pagina_champions_1",
        "apuestas_pagina_mundial_1",
        "apuestas_pagina_eurocopa_1",
        "apuestas_pagina_copa_rey_1",
        "apuestas_pagina_europa_1",
        "quiniela_refrescar_premier",
        "liga_ver",
    ]);
    expect(pestanas(payload).map(([id]) => id)).toEqual(PESTANAS);
});

test("los botones de /juegos solo los usa quien lo abrió", async () => {
    const i = interaccion({ customId: "juegos_stats", user: { id: "otro", username: "otro" } });
    await juegos.handleButton(null, i);
    expect(i.update).not.toHaveBeenCalled();
    expect(i.reply.mock.calls[0][0].content).toMatch(/Solo quien/);
});

test("los 8 comandos antiguos ya no se registran; /juegos sí", () => {
    const nombres = [];
    const walk = (d) =>
        fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js") && require(p).data) nombres.push(require(p).data.name);
        });
    walk(path.join(__dirname, "../src/commands"));
    expect(nombres).toContain("juegos");
    for (const viejo of ["blackjack", "ruleta", "tragaperras", "adivinar", "ppt", "apuestas", "quiniela", "misapuestas"]) {
        expect(nombres).not.toContain(viejo);
    }
});

// Discord rechaza un mensaje con dos botones con el mismo customId (COMPONENT_CUSTOM_ID_DUPLICATED): pasó con
// la pestaña 📋 Mis jugadas y el botón ⏳ En juego. Se revisan todas las pantallas de /juegos.
describe("ningún panel de /juegos repite un customId", () => {
    const casino = require("../src/paneles/casino");
    const { buildMisJugadas } = require("../src/paneles/misJugadas");
    const { buildStatsJuegos } = require("../src/paneles/juegos");
    const quiniela = require("../src/juegos/apuestas/quiniela");
    const idsDe = (payload) => payload.components.flatMap((r) => (r.toJSON ? r.toJSON() : r).components.map((c) => c.custom_id));
    const sinRepetidos = (payload) => {
        const ids = idsDe(payload);
        expect(ids.filter((id, n) => ids.indexOf(id) !== n)).toEqual([]);
    };

    test("casino, selectores, final de partida, mis jugadas y stats", () => {
        for (const payload of [
            casino.buildHome("u4"),
            casino.buildStats("u4", "u4"),
            casino.buildStats("u4", "u4", "blackjack"),
            casino.buildHistorial("u4"),
            casino.buildRanking(),
            casino.buildPickApuesta("u4", "blackjack"),
            casino.buildPickRuleta("u4"),
            casino.buildPickDocenas("u4"),
            casino.buildPickMontoRuleta("u4", "color", "rojo"),
            casino.buildPickJugadaPpt("u4", 100),
            { components: [casino.filaFinJuego("ruleta", 100, { repetir: "casino_play_ruleta_100_color_rojo" })] },
            buildMisJugadas("u4", "activas"),
            buildMisJugadas("u4", "historial"),
            buildStatsJuegos("u4", "u4"),
        ]) {
            sinRepetidos(payload);
        }
    });

    test("apuestas y quiniela (con y sin apuesta hecha)", async () => {
        const apuestasTab = interaccion({ customId: "juegos_apuestas_premier" });
        await juegos.handleButton(null, apuestasTab);
        sinRepetidos(apuestasTab.update.mock.calls[0][0]);

        const q = db
            .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('premier', 'J-dup', 'abierta', '2026-09-01')")
            .run().lastInsertRowid;
        db.prepare(
            "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, 'qd', 1, 'A', 'B', ?)",
        ).run(q, futuro);
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en) VALUES (?, 'u4', '1', 10, '2026-09-01')",
        ).run(q);
        for (const user of [
            { id: "u4", username: "u4" },
            { id: "sin-apuesta", username: "x" },
        ]) {
            const i = interaccion({ customId: "quiniela_refrescar_premier", user });
            await quiniela.handleButton(null, i);
            sinRepetidos(i.update.mock.calls[0][0]);
        }
    });
});
