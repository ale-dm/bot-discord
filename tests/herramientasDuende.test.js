// Herramientas nuevas del Duende (solo lectura, siempre de quien habla): tienda, inventario, apuestas, casino y diario.
const db = require("../src/core/db");
const { DUENDE_CORE_TOOL_DECLARATIONS, DUENDE_TOOL_EXECUTORS: h } = require("../src/services/duende/herramientas");

const G = "guild-herramientas";
const ctx = { guildId: G, userId: "habla", channelId: "c1" };
const ahora = Date.now();

beforeAll(() => {
    // Desde un catálogo vacío: la migración 023 pone a la venta el candado y la trampa (F-EC-06c).
    db.prepare("DELETE FROM tienda").run();
    db.prepare("DELETE FROM objeto").run();
    const espada = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, rareza) VALUES ('Espada', 'Corta', 'coleccionable', 'épico')")
        .run().lastInsertRowid;
    const pocion = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, efecto) VALUES ('Poción', 'Cura', 'consumible', 'monedas:5')")
        .run().lastInsertRowid;
    db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, 500, NULL), (?, 50, 3)").run(espada, pocion);
    for (const [userId, item] of [
        ["habla", pocion],
        ["habla", pocion],
        ["otro", espada],
    ]) {
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, item, new Date().toISOString());
    }
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, deporte) VALUES ('m1', 'Betis', 'Sevilla', ?, 'laliga')",
    ).run(new Date(ahora + 3600_000).toISOString());
    db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('habla', 'm1', 'away', 100, 2.5)",
    ).run();
    db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('otro', 'm1', 'home', 999, 2)").run();
    const casino = db.prepare("INSERT INTO casino (userId, juego, fecha, apuesta, resultado) VALUES (?, ?, ?, ?, ?)");
    casino.run("habla", "ruleta", new Date(ahora - 2000).toISOString(), 100, 100);
    casino.run("habla", "blackjack", new Date(ahora - 1000).toISOString(), 50, -50);
    casino.run("otro", "ruleta", new Date(ahora).toISOString(), 10, 5000);
});

test("están declaradas para Gemini junto a las básicas", () => {
    const nombres = DUENDE_CORE_TOOL_DECLARATIONS.map((d) => d.name);
    for (const n of [
        "consultar_tienda",
        "consultar_inventario",
        "consultar_mis_apuestas",
        "consultar_partidas_casino",
        "consultar_recompensa_diaria",
        "consultar_perfil_persona",
    ]) {
        expect(nombres).toContain(n);
        expect(typeof h[n]).toBe("function");
    }
});

test("la tienda, con filtro opcional", () => {
    const todo = h.consultar_tienda({}, ctx);
    expect(todo.total).toBe(2);
    expect(todo.a_la_venta[0]).toMatchObject({ nombre: "Espada", precio: 500, stock: "ilimitado", rareza: "épico" });
    expect(h.consultar_tienda({ busqueda: "Poci" }, ctx).a_la_venta).toEqual([expect.objectContaining({ nombre: "Poción", stock: 3 })]);
});

test("el inventario es solo el de quien habla", () => {
    expect(h.consultar_inventario({}, ctx)).toEqual({
        objetos: [{ nombre: "Poción", cantidad: 2, tipo: "consumible", rareza: null, se_puede_usar: true }],
        distintos: 1,
    });
});

test("sus apuestas en juego, con lo que ganaría", () => {
    const r = h.consultar_mis_apuestas({}, ctx);
    expect(r.partidos_en_juego).toEqual([
        expect.objectContaining({ partido: "Betis vs Sevilla", apostado_a: "Sevilla", cantidad: 100, ganaria: 250 }),
    ]);
    expect(r.balance_partidos).toEqual({ apostado: 0, ganado: 0, en_juego: 100 });
});

test("sus últimas partidas del casino y el total ganado y perdido", () => {
    expect(h.consultar_partidas_casino({ cantidad: 1 }, ctx)).toEqual({
        ultimas_partidas: [{ juego: "blackjack", apostado: 50, resultado_neto: -50 }],
        total_ganado: 100,
        total_perdido: 50,
    });
});

test("la recompensa diaria solo se consulta, no se cobra", () => {
    const r = h.consultar_recompensa_diaria({}, ctx);
    expect(r).toMatchObject({ activa: true, puede_cobrar_hoy: true, cantidad: 100 });
    expect(h.consultar_recompensa_diaria({}, ctx).puede_cobrar_hoy).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM recompensa_diaria").get().n).toBe(0);
});

function guildConMiembros(miembros) {
    const cache = new Map(miembros.map((m) => [m.id, m]));
    cache.find = (fn) => [...cache.values()].find(fn);
    return { id: "g-perfil", members: { cache } };
}

test("consultar_perfil_persona encuentra a alguien conocido por su nombre", () => {
    db.prepare(
        "INSERT INTO duende_perfiles (discord_id, username, nombre, descripcion) VALUES ('555', 'coneyo', 'Coneyo', 'Es el gracioso del grupo')",
    ).run();
    const guild = guildConMiembros([{ id: "555", user: { id: "555", username: "coneyo" }, displayName: "Coneyo" }]);

    expect(h.consultar_perfil_persona({ persona: "Coneyo" }, { ...ctx, guild })).toMatchObject({
        encontrado: true,
        nombre: "Coneyo",
        info: "Es el gracioso del grupo",
    });
});

test("consultar_perfil_persona con 'yo' consulta el perfil de quien habla", () => {
    db.prepare(
        "INSERT INTO duende_perfiles (discord_id, username, nombre, descripcion) VALUES ('habla', 'habla', 'Habla', 'Habla mucho')",
    ).run();
    const guild = guildConMiembros([{ id: "habla", user: { id: "habla", username: "habla" }, displayName: "Habla" }]);

    expect(h.consultar_perfil_persona({ persona: "yo" }, { ...ctx, guild })).toMatchObject({ encontrado: true, info: "Habla mucho" });
});

test("consultar_perfil_persona no inventa a alguien que no identifica", () => {
    const guild = guildConMiembros([]);
    expect(h.consultar_perfil_persona({ persona: "nadie_de_este_server" }, { ...ctx, guild })).toEqual({
        encontrado: false,
        nota: expect.stringContaining("No identifico"),
    });
});
