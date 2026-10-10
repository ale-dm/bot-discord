// Cancelar una apuesta (F-AP-05, issue #4): antes de que empiece el partido, desde 📋 Mis jugadas, con un 10 % de
// comisión. Se apuesta de verdad (formulario de /juegos → ⚽ Apuestas) y se cancela con los botones del panel.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const cancelar = require("../src/systems/apuestas/cancelar");
const apuestas = require("../src/juegos/apuestas/apuestas");
const misapuestas = require("../src/paneles/misJugadas");
const { buildMisJugadas } = require("../src/paneles/misJugadas");

const futuro = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const pasado = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const partido = db.prepare(
    "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away) VALUES (?, ?, ?, ?, 'abierto', 'laliga', 2, 3, 4)",
);
partido.run("c-1", "Celta", "Alavés", futuro(5));
partido.run("c-2", "Betis", "Sevilla", futuro(30));
// Ya ha empezado (aún sin liquidar): no se puede cancelar.
partido.run("c-3", "Real", "Barça", pasado(1));
db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES ('ana', 0, 1000)").run();

const interaccion = (extra = {}) => ({
    user: { id: "ana", tag: "ana", username: "ana" },
    guildId: "g",
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    isButton: () => true,
    ...extra,
});
const filas = (payload) => payload.components.map((r) => (r.toJSON ? r.toJSON() : r));
const ids = (payload) => filas(payload).flatMap((r) => r.components.map((c) => c.custom_id));
const menuCancelar = (payload) =>
    filas(payload)
        .flatMap((r) => r.components)
        .find((c) => c.custom_id === "misapuestas_cancelarsel_ana");

async function apostar(matchId, cantidad) {
    const i = interaccion({
        customId: `apuestas_modal_home_${matchId}`,
        fields: { getStringSelectValues: () => null, getTextInputValue: () => String(cantidad) },
    });
    await apuestas.handleModal(null, i);
    return db.prepare("SELECT id FROM apuestas_usuario WHERE user_id = 'ana' AND match_id = ?").get(matchId).id;
}

test("la comisión es el 10 %, redondeando hacia arriba y de al menos 1 moneda", () => {
    expect(cancelar.comision(100)).toBe(10);
    expect(cancelar.comision(15)).toBe(2);
    expect(cancelar.comision(10)).toBe(1);
    expect(cancelar.comision(1)).toBe(1);
});

test("apostar, cancelar desde Mis jugadas y recuperar lo apostado menos la comisión (una sola vez)", async () => {
    const id = await apostar("c-1", 100);
    await apostar("c-2", 15);
    expect(dinero.efectivo("ana")).toBe(1000 - 100 - 15);

    // ⏳ En juego tiene el menú (antes de las pestañas de /juegos, que siguen en la última fila).
    const panel = buildMisJugadas("ana", "activas");
    const menu = menuCancelar(panel);
    expect(menu.options.map((o) => o.description)).toEqual(["Celta · 100 🪙 → te devuelvo 90 🪙", "Betis · 15 🪙 → te devuelvo 13 🪙"]);
    expect(ids(panel).at(-1)).toBe("juegos_stats");
    // 📋 Resueltas no.
    expect(menuCancelar(buildMisJugadas("ana", "historial"))).toBeUndefined();

    // Elegirla enseña cuánto se devuelve, con el botón para confirmar y el de volver.
    const elegir = interaccion({ customId: "misapuestas_cancelarsel_ana", values: [String(id)] });
    await misapuestas.handleSelect(null, elegir);
    const confirmar = elegir.update.mock.calls[0][0];
    expect(confirmar.embeds[0].data.description).toMatch(
        /Te devuelvo \*\*90\*\* 🪙 al efectivo: lo apostado menos \*\*10\*\* 🪙 de comisión/,
    );
    expect(ids(confirmar)).toEqual([`misapuestas_cancelarok_${id}_ana`, "misapuestas_activas_ana"]);

    const ok = interaccion({ customId: `misapuestas_cancelarok_${id}_ana` });
    await misapuestas.handleButton(null, ok);
    const tras = ok.update.mock.calls[0][0];
    expect(tras.content).toMatch(/Apuesta cancelada: \*\*Celta vs Alavés\*\*\. Te he devuelto \*\*90\*\*/);
    expect(dinero.efectivo("ana")).toBe(1000 - 15 - 10);
    expect(db.prepare("SELECT COUNT(*) AS n FROM apuestas_usuario WHERE id = ?").get(id).n).toBe(0);
    expect(dinero.movimientos("ana", { tipo: "apuestas", limite: 1 }).filas[0]).toMatchObject({
        descripcion: "Apuesta cancelada: Celta vs Alavés (comisión de 10)",
        cantidad: 90,
    });
    // Ya no sale en el menú; la del Betis, sí.
    expect(menuCancelar(tras).options.map((o) => o.label)).toEqual(["Betis vs Sevilla"]);

    // Pulsar otra vez el mismo botón (o un doble clic) no devuelve nada más.
    const otraVez = interaccion({ customId: `misapuestas_cancelarok_${id}_ana` });
    await misapuestas.handleButton(null, otraVez);
    expect(otraVez.update.mock.calls[0][0].content).toMatch(/ya no se puede cancelar/);
    expect(dinero.efectivo("ana")).toBe(1000 - 15 - 10);
});

test("un partido que ya ha empezado no se puede cancelar", () => {
    db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('ana', 'c-3', 'home', 200, 2)").run();
    const id = db.prepare("SELECT id FROM apuestas_usuario WHERE match_id = 'c-3'").get().id;
    const antes = dinero.efectivo("ana");
    expect(cancelar.cancelables("ana").map((a) => a.match_id)).not.toContain("c-3");
    expect(cancelar.cancelar("ana", id)).toMatchObject({ ok: false });
    expect(dinero.efectivo("ana")).toBe(antes);
    expect(db.prepare("SELECT COUNT(*) AS n FROM apuestas_usuario WHERE id = ?").get(id).n).toBe(1);
});

test("nadie puede cancelar la apuesta de otro", async () => {
    const id = db.prepare("SELECT id FROM apuestas_usuario WHERE match_id = 'c-2'").get().id;
    const antes = dinero.efectivo("ana");
    const intruso = interaccion({ customId: `misapuestas_cancelarok_${id}_ana`, user: { id: "luis" } });
    await misapuestas.handleButton(null, intruso);
    expect(intruso.update).not.toHaveBeenCalled();
    expect(intruso.reply.mock.calls[0][0].content).toMatch(/Solo puedes ver tus propias apuestas/);
    // Ni aunque llame con su propio id a una apuesta que no es suya.
    expect(cancelar.cancelar("luis", id)).toMatchObject({ ok: false });
    expect(dinero.efectivo("ana")).toBe(antes);
    expect(dinero.efectivo("luis")).toBe(dinero.INICIAL);
});
