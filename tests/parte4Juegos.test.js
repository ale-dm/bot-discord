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
const PESTANAS = ["casino_home", "juegos_apuestas_laliga", "misapuestas_activas_u4", "juegos_stats"];

test.each([
    ["casino", "🎰 Casino — Tu resumen", 0],
    ["jugadas", "⏳ Lo que tienes en juego", 2],
    ["stats", "📊 Estadísticas de u4", 3],
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
    const competiciones = payload.components.at(-2).components.map((b) => b.data.custom_id);
    expect(competiciones).toEqual([
        "apuestas_pagina_laliga_1",
        "apuestas_pagina_premier_1",
        "apuestas_pagina_champions_1",
        "quiniela_refrescar_premier",
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
