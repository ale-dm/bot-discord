// Límites por jugador en las apuestas (F-AP-09, issue #6): tope diario (partidos y quiniela) y máximo por partido,
// configurables en /paneladmin → ⚽ Apuestas → 🚦 Límites. Se apuesta con los formularios de verdad.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const limites = require("../src/systems/apuestas/limites");
const apuestas = require("../src/juegos/apuestas/apuestas");
const quiniela = require("../src/juegos/apuestas/quiniela");
const paneladmin = require("../src/commands/admin/paneladmin");

const G = "g-limites";
const SIN_LIMITES = "g-sin-limites";
const futuro = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const partido = db.prepare(
    "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES (?, ?, ?, ?, 'abierto', 'laliga', 2, 3, 4)",
);
partido.run("l-1", "Celta", "Alavés", futuro(5));
partido.run("l-2", "Betis", "Sevilla", futuro(6));
const qId = db
    .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', 'Jornada 9', 'abierta', ?)")
    .run(new Date().toISOString()).lastInsertRowid;
db.prepare(
    "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, 'lq-1', 1, 'A', 'B', ?), (?, 'lq-2', 2, 'C', 'D', ?)",
).run(qId, futuro(48), qId, futuro(49));

const formulario = (guildId, customId, campos, user = "ana") => ({
    guildId,
    customId,
    user: { id: user, tag: user, username: user },
    fields: { getStringSelectValues: () => null, getTextInputValue: (k) => campos[k] ?? "" },
    reply: jest.fn(async () => {}),
});
const textoRespuesta = (i) => {
    const r = i.reply.mock.calls[0][0];
    return r.content || r.embeds[0].data.title + " " + r.embeds[0].data.description;
};
const apostar = async (guildId, matchId, eleccion, cantidad, user) => {
    const i = formulario(guildId, `apuestas_modal_${eleccion}_${matchId}`, { cantidad: String(cantidad) }, user);
    await apuestas.handleModal(null, i);
    return textoRespuesta(i);
};
const apostarQuiniela = async (guildId, cantidad, user) => {
    const i = formulario(guildId, `quiniela_modal_confirmar_${qId}`, { pronosticos: "1X", cantidad: String(cantidad) }, user);
    await quiniela.handleModal(null, i);
    return textoRespuesta(i);
};

test("sin límites configurados (por defecto) no se limita nada", async () => {
    expect(limites.limites(SIN_LIMITES)).toEqual({ topeDiario: 0, maxPartido: 0 });
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('rico', 0, 5000)").run();
    expect(await apostar(SIN_LIMITES, "l-1", "home", 1000, "rico")).toMatch(/Apuesta registrada/);
    expect(await apostar(SIN_LIMITES, "l-1", "away", 1000, "rico")).toMatch(/Apuesta registrada/);
});

test("máximo por partido y tope diario, con lo que queda en el mensaje", async () => {
    guildSettings.setManySettings(G, { "apuestas.tope_diario": 300, "apuestas.max_partido": 150 });

    expect(await apostar(G, "l-1", "home", 100)).toMatch(/Apuesta registrada/);
    // 100 + 60 en el mismo partido se pasa de 150 (aunque sea a otro resultado): no se cobra nada.
    const efectivo = dinero.efectivo("ana");
    expect(await apostar(G, "l-1", "draw", 60)).toBe(
        "🚦 Límite de apuestas El máximo por partido es de **150** 🪙 y en este ya tienes **100** 🪙: como mucho puedes apostar **50** 🪙 más.",
    );
    expect(dinero.efectivo("ana")).toBe(efectivo);
    expect(await apostar(G, "l-1", "draw", 50)).toMatch(/Apuesta registrada/);

    // Otro partido: 150 + 120 = 270, dentro del tope de 300.
    expect(await apostar(G, "l-2", "home", 120)).toMatch(/Apuesta registrada/);
    // La quiniela también cuenta para el tope: 270 + 40 se pasa.
    expect(await apostarQuiniela(G, 40)).toBe(
        "🚦 Hoy ya has apostado **270** 🪙 y el tope diario es de **300** 🪙: como mucho puedes apostar **30** 🪙 más hasta mañana.",
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM quiniela_apuestas WHERE user_id = 'ana'").get().n).toBe(0);
    expect(await apostarQuiniela(G, 30)).toMatch(/Quiniela registrada/);
    // Y con el tope ya cubierto, ni una moneda más.
    expect(await apostar(G, "l-2", "away", 10)).toMatch(/hasta mañana no puedes apostar más/);
    expect(limites.apostadoHoy("ana")).toBe(300);
    // Los límites son por persona.
    expect(await apostar(G, "l-2", "away", 150, "luis")).toMatch(/Apuesta registrada/);
});

test("el día va en hora de Madrid y solo cuenta lo apostado (no lo cobrado ni lo devuelto)", () => {
    const ahora = Date.UTC(2026, 9, 15, 10); // 15 de octubre, 12:00 en Madrid
    const apunte = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES ('pepe', ?, ?, ?, ?)");
    apunte.run("2026-10-14T22:30:00.000Z", "Apuesta: A vs B", -100, "apuestas"); // 00:30 del 15 en Madrid: cuenta
    apunte.run("2026-10-14T21:30:00.000Z", "Apuesta: C vs D", -500, "apuestas"); // 23:30 del 14 en Madrid: no
    apunte.run("2026-10-15T09:00:00.000Z", "Quiniela: apuesta", -50, "apuestas");
    apunte.run("2026-10-15T09:30:00.000Z", "Apuesta ganada: A vs B", 400, "apuestas");
    apunte.run("2026-10-15T09:40:00.000Z", "Ruleta", -700, "casino");
    expect(limites.apostadoHoy("pepe", ahora)).toBe(150);
});

describe("/paneladmin → ⚽ Apuestas → 🚦 Límites", () => {
    const interaccion = (extra) => ({
        guildId: G,
        guild: { id: G },
        user: { id: "admin", tag: "admin", username: "admin" },
        member: { permissions: { has: () => true } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const modal = (campos) =>
        interaccion({
            customId: "paneladmin_apu_limites_modal",
            fields: { getStringSelectValues: () => null, getTextInputValue: (k) => campos[k] ?? "" },
        });

    test("el formulario trae los valores actuales y guarda los nuevos", async () => {
        const boton = interaccion({ customId: "paneladmin_apu_limites" });
        await paneladmin.handleButton(null, boton);
        const campos = boton.showModal.mock.calls[0][0].toJSON().components.map((r) => r.components[0]);
        expect(campos.map((c) => [c.custom_id, c.value])).toEqual([
            ["tope", "300"],
            ["partido", "150"],
        ]);

        const ok = modal({ tope: "20000", partido: "0" });
        await paneladmin.handleModal(null, ok);
        expect(guildSettings.getSettings(G).apuestas).toMatchObject({ tope_diario: 20000, max_partido: 0 });
        const campo = ok.update.mock.calls[0][0].embeds[0].data.fields.find((f) => f.name === "🚦 Límites por jugador").value;
        expect(campo).toBe("Tope diario (partidos y quiniela): **20.000** 🪙\nMáximo por partido: sin límite");
    });

    test("no acepta números negativos ni texto", async () => {
        for (const campos of [
            { tope: "-1", partido: "0" },
            { tope: "100", partido: "mucho" },
            { tope: "1.5", partido: "0" },
        ]) {
            const mal = modal(campos);
            await paneladmin.handleModal(null, mal);
            expect(mal.reply.mock.calls[0][0].content).toMatch(/números enteros/);
        }
        expect(guildSettings.getSettings(G).apuestas).toMatchObject({ tope_diario: 20000, max_partido: 0 });
    });
});
