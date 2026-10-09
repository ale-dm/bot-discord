// 🏅 Liga de pronósticos (F-AP-12, #8): los puntos son los aciertos de las quinielas cerradas en la temporada (julio a
// junio, hora de Madrid), el desempate, la liquidación una vez por temporada (1 de julio desde las 10:00) y el panel.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const liga = require("../src/systems/apuestas/liga");
const { pantallaLiga } = require("../src/paneles/liga");
const boton = require("../src/juegos/apuestas/apuestas");

const G = "g-liga";
const CANAL = "c-liga";

function quiniela(cerradaEn, estado, apuestas) {
    const id = db
        .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en, cerrada_en) VALUES ('laliga', 'J', ?, ?, ?)")
        .run(estado, "2026-01-01T00:00:00.000Z", cerradaEn).lastInsertRowid;
    for (const [userId, aciertos] of apuestas) {
        db.prepare(
            "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, aciertos, premio, pagado, creada_en) VALUES (?, ?, '1', 100, ?, 0, 1, 'x')",
        ).run(id, userId, aciertos);
    }
}

// Temporada 2025-26 (no cuenta para 2026-27): ana 9.
quiniela("2026-06-20T10:00:00.000Z", "cerrada", [["ana", 9]]);
// Temporada 2026-27: ana 3 · marta 2 · luis 0 (Q_A); marta 2 · luis 1 (Q_B). Una caducada, con 9 aciertos, no cuenta.
quiniela("2026-10-10T20:00:00.000Z", "cerrada", [
    ["ana", 3],
    ["marta", 2],
    ["luis", 0],
]);
quiniela("2026-10-17T20:00:00.000Z", "cerrada", [
    ["marta", 2],
    ["luis", 1],
]);
quiniela("2026-10-18T20:00:00.000Z", "caducada", [["pepe", 9]]);
// Luis y marta empatan a 4 puntos y 3 quinielas: el desempate es el id (luis va antes).
quiniela("2026-11-01T20:00:00.000Z", "cerrada", [
    ["luis", 3],
    ["marta", 0],
]);

const OCT_2026 = Date.UTC(2026, 9, 20, 12); // 20 de octubre, en plena temporada 2026-27

let canal;
let guild;
beforeEach(() => {
    canal = { isTextBased: () => true, send: jest.fn(async () => {}) };
    guild = { id: G, name: "Liga", channels: { cache: new Map([[CANAL, canal]]) } };
    guildSettings.setSetting(G, "clasificacion.canal", CANAL);
    guildSettings.setSetting(G, "liga.premio_1", 5000);
    guildSettings.setSetting(G, "liga.premio_2", 2500);
    guildSettings.setSetting(G, "liga.premio_3", 1000);
});
afterEach(() => {
    db.prepare("DELETE FROM liga_temporadas WHERE guildId IN (?, 'g-panel', 'g-sin-canal')").run(G);
});

test("la temporada va de julio a junio, en hora de Madrid", () => {
    expect(liga.temporadaDe(Date.UTC(2026, 5, 30, 21))).toBe("2025-26"); // 30 de junio, 23:00 en Madrid
    expect(liga.temporadaDe(Date.UTC(2026, 5, 30, 22))).toBe("2026-27"); // 1 de julio, 00:00 en Madrid
    expect(liga.temporadaDe(OCT_2026)).toBe("2026-27");
    expect(liga.rangoISO("2026-27")).toEqual({ desde: "2026-06-30T22:00:00.000Z", hasta: "2027-06-30T22:00:00.000Z" });
});

test("la clasificación suma los aciertos de las quinielas cerradas de la temporada", () => {
    expect(liga.clasificacion("2026-27")).toEqual([
        { userId: "luis", puntos: 4, quinielas: 3 },
        { userId: "marta", puntos: 4, quinielas: 3 },
        { userId: "ana", puntos: 3, quinielas: 1 },
    ]);
    expect(liga.clasificacion("2025-26")).toEqual([{ userId: "ana", puntos: 9, quinielas: 1 }]);
});

test("el 1 de julio, desde las 10:00, se liquida la temporada anterior: se publica, se paga y no se repite", async () => {
    const client = { guilds: { cache: new Map([[G, guild]]) } };
    const antesDe10 = Date.UTC(2027, 6, 1, 7); // 9:00 en Madrid
    const despues = Date.UTC(2027, 6, 1, 9); // 11:00 en Madrid

    expect(await liga.liquidarSiToca(client, antesDe10)).toBe(0);
    expect(canal.send).not.toHaveBeenCalled();

    const luisAntes = dinero.efectivo("luis");
    expect(await liga.liquidarSiToca(client, despues)).toBe(1);
    expect(canal.send).toHaveBeenCalledTimes(1);
    const { content } = canal.send.mock.calls[0][0];
    expect(content).toMatch(/Liga de pronósticos 2026-27/);
    expect(content).toMatch(/🥇 <@luis> · \*\*4\*\* puntos \(3 quinielas\)/);
    expect(dinero.efectivo("luis")).toBeGreaterThan(luisAntes);

    expect(await liga.liquidarSiToca(client, despues)).toBe(0);
    expect(canal.send).toHaveBeenCalledTimes(1);
    expect(liga.campeonesAnteriores(G)[0].campeones.map((c) => [c.userId, c.premio])).toEqual([
        ["luis", 5000],
        ["marta", 2500],
        ["ana", 1000],
    ]);
});

test("sin canal no se publica ni se paga nada", async () => {
    guildSettings.setSetting(G, "clasificacion.canal", "");
    const client = { guilds: { cache: new Map([[G, guild]]) } };
    expect(await liga.liquidarSiToca(client, Date.UTC(2027, 6, 1, 9))).toBe(0);
    expect(canal.send).not.toHaveBeenCalled();
    expect(liga.campeonesAnteriores(G)).toEqual([]);
});

test("el panel muestra la clasificación, tu posición y los premios", () => {
    const p = pantallaLiga(G, "marta", OCT_2026);
    const embed = p.embeds[0].data;
    expect(embed.title).toBe("🏅 Liga de pronósticos · 2026-27");
    expect(embed.description).toMatch(/\*\*5000\*\* 🪙 · \*\*2500\*\* 🪙 · \*\*1000\*\* 🪙/);
    const campo = (nombre) => embed.fields.find((f) => f.name === nombre).value;
    expect(campo("📊 Clasificación")).toMatch(/1\. <@luis> · \*\*4\*\* puntos/);
    expect(campo("📍 Tu posición")).toBe("2.º con **4** puntos");
    expect(campo("🏆 Temporadas anteriores")).toBe("Ninguna todavía.");
    expect(p.components[0].components[0].data.custom_id).toBe("apuestas_pagina_laliga_1");
});

test("el panel enseña los campeones de las temporadas anteriores", () => {
    db.prepare("INSERT INTO liga_temporadas (guildId, temporada, campeones, liquidada_en) VALUES ('g-panel', '2025-26', ?, 1)").run(
        JSON.stringify([{ userId: "ana", puntos: 9, quinielas: 1, premio: 5000 }]),
    );
    const campo = pantallaLiga("g-panel", "nadie", OCT_2026).embeds[0].data.fields.find((f) => f.name === "🏆 Temporadas anteriores");
    expect(campo.value).toBe("**2025-26** · 🥇 <@ana> (9 pts)");
    db.prepare("DELETE FROM liga_temporadas WHERE guildId = 'g-panel'").run();
});

test("el botón 🏅 Liga actualiza el mensaje con la pantalla de la liga", async () => {
    let payload = null;
    await boton.handleLiga(null, {
        customId: "liga_ver",
        guildId: G,
        user: { id: "luis" },
        update: async (p) => {
            payload = p;
        },
    });
    expect(payload.embeds[0].data.title).toMatch(/Liga de pronósticos/);
});
