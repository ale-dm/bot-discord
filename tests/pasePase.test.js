// 🛡️ Pase de batalla (#36): la curva de niveles, las temporadas de 15 días, el tope diario por categoría, las misiones del
// día (su XP al completarse), cobrar las recompensas una sola vez y en efectivo, los eventos globales y el panel.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const pase = require("../src/systems/pase/pase");
const { pantallaPase } = require("../src/paneles/pase");

const G = "g-pase";
const DIA = 86400 * 1000;
const ORIGEN = Date.UTC(2026, 9, 1);
const HOY = ORIGEN + 3600 * 1000; // el primer día de la temporada 0, por la mañana: misiones 0 (mensajes, voz, casino)
let n = 0;
const nuevo = () => `pase-${++n}`;

beforeEach(() => {
    db.prepare("DELETE FROM pase_progreso WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM pase_caps WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM pase_misiones WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM pase_recompensas WHERE guildId = ?").run(G);
});

test("la curva de niveles: 280 para el 2, 320 más para el 3, y el 20 es el máximo", () => {
    expect(pase.xpParaNivel(1)).toBe(0);
    expect(pase.xpParaNivel(2)).toBe(280);
    expect(pase.xpParaNivel(3)).toBe(600);
    expect(pase.nivelDe(0)).toBe(1);
    expect(pase.nivelDe(279)).toBe(1);
    expect(pase.nivelDe(280)).toBe(2);
    expect(pase.nivelDe(1e9)).toBe(20);
});

test("las temporadas son bloques de 15 días desde el 1 de octubre de 2026", () => {
    expect(pase.temporadaDe(HOY).numero).toBe(0);
    expect(pase.temporadaDe(ORIGEN + 15 * DIA).numero).toBe(1);
    expect(pase.temporadaDe(ORIGEN + 15 * DIA).inicio).toBe(ORIGEN + 15 * DIA);
});

test("cada categoría tiene su tope diario: mensajes, hasta 120 de XP al día", () => {
    const u = nuevo();
    let total = 0;
    for (let i = 0; i < 80; i++) total += pase.registrar(G, u, "mensaje", 1, HOY);
    expect(total).toBe(120);
    expect(pase.registrar(G, u, "mensaje", 1, HOY)).toBe(0);
    // Al día siguiente, otra vez desde cero.
    expect(pase.registrar(G, u, "mensaje", 1, HOY + DIA)).toBe(2);
});

test("completar una misión del día da su XP, una sola vez", () => {
    const u = nuevo();
    for (let i = 0; i < 25; i++) pase.registrar(G, u, "mensaje", 1, HOY); // 25 mensajes: 50 XP y la misión "mensajes"
    const e = pase.estado(G, u, HOY);
    expect(e.misiones.find((m) => m.id === "mensajes")).toMatchObject({ progreso: 25, completada: true });
    expect(e.xp).toBe(50 + pase.MISION_XP);
    pase.registrar(G, u, "mensaje", 1, HOY); // ya completada: no vuelve a dar la XP de la misión
    expect(pase.estado(G, u, HOY).xp).toBe(50 + 2 + pase.MISION_XP);
});

test("el nivel 1 se puede cobrar desde el principio; reclamar paga en efectivo y una sola vez", () => {
    const u = nuevo();
    dinero.pagar(u, 0);
    const antes = dinero.efectivo(u);
    expect(pase.estado(G, u, HOY).pendientes.map((r) => r.nivel)).toEqual([1]);

    pase.registrar(G, u, "tienda", 1, HOY); // 8 XP
    pase.registrar(G, u, "casino", 40, HOY); // hasta 260 XP (tope)
    const e = pase.estado(G, u, HOY);
    expect(e.nivel).toBe(2);
    expect(e.pendientes.map((r) => r.nivel)).toEqual([1, 2]);

    const r = pase.reclamar(G, u, HOY);
    expect(r).toEqual({ ok: true, monedas: 80 + 120, niveles: [1, 2] });
    expect(dinero.efectivo(u)).toBe(antes + 200);
    expect(pase.reclamar(G, u, HOY)).toEqual({ ok: false, monedas: 0, niveles: [] });
});

test("los eventos globales (apuestas, cripto) cuentan en cada servidor donde la persona tiene XP", () => {
    const u = nuevo();
    db.prepare("INSERT OR IGNORE INTO xp_users (guildId, userId, xp_total) VALUES (?, ?, 0)").run(G, u);
    pase.registrarEnTodos(u, "apuesta", 1, HOY);
    expect(pase.estado(G, u, HOY).xp).toBe(12);
});

test("un evento que no existe, o un fallo, no rompe nada", () => {
    expect(() => pase.registrarSeguro(G, nuevo(), "no-existe", 1, HOY)).not.toThrow();
    expect(pase.registrar(G, nuevo(), "no-existe", 1, HOY)).toBe(0);
});

test("el top ordena por XP de la temporada actual", () => {
    const a = nuevo();
    const b = nuevo();
    pase.registrar(G, a, "casino", 10, HOY); // 260
    pase.registrar(G, b, "tienda", 2, HOY); // 16
    expect(pase.top(G, 10, HOY).map((t) => t.userId)).toEqual([a, b]);
});

describe("el panel", () => {
    test("el resumen tiene el botón de reclamar apagado si no hay nada, y encendido si hay algo", () => {
        const u = nuevo();
        const apagado = pantallaPase(G, u, "resumen", { ahora: HOY + DIA * 5 }); // el nivel 1 está alcanzado y sin cobrar
        expect(apagado.components[0].components[0].data.custom_id).toBe("pase_reclamar");
        expect(apagado.components[0].components[0].data.disabled).toBeFalsy();
        pase.reclamar(G, u, HOY + DIA * 5);
        const cobrado = pantallaPase(G, u, "resumen", { ahora: HOY + DIA * 5 });
        expect(cobrado.components[0].components[0].data.disabled).toBe(true);
    });

    test("la vista de niveles enseña los 20 niveles y la de misiones, las 3 del día", () => {
        const u = nuevo();
        const niveles = pantallaPase(G, u, "niveles", { ahora: HOY });
        const campos = niveles.embeds[0].data.fields.map((f) => f.value).join("\n");
        expect((campos.match(/Nivel \d+/g) || []).length).toBe(20);
        const misiones = pantallaPase(G, u, "misiones", { ahora: HOY });
        expect((misiones.embeds[0].data.fields[0].value.match(/\/\d+/g) || []).length).toBe(3);
    });
});
