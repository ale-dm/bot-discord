// /robar (F-EC-06b): éxito/fallo, multa, cooldown GLOBAL (no por servidor) y que lo robado se
// guarde como dinero negro, aparte del efectivo normal.
process.env.ROBAR_COOLDOWN_SEC = "7200";
process.env.ROBAR_MIN_VICTIMA = "150";
process.env.ROBAR_PROB_EXITO = "0.65";
process.env.ROBAR_BASE_MIN = "50";
process.env.ROBAR_BASE_MAX = "150";
process.env.ROBAR_BONUS_NIVEL = "2";
process.env.ROBAR_MULTA_MIN = "30";
process.env.ROBAR_MULTA_MAX = "80";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { robar } = require("../src/systems/robar");

const G = "guild-robar";

beforeEach(() => {
    db.prepare("DELETE FROM robos_cooldown").run();
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
});

afterEach(() => {
    if (jest.isMockFunction(Math.random)) Math.random.mockRestore();
});

test("si sale bien, roba del efectivo de la víctima (base + bonus de nivel) y se lo queda como dinero negro", () => {
    db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 10, 0)").run(G, "ladron1");
    dinero.pagar("victima1", 1000);
    jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0); // éxito; cantidad base = BASE_MIN

    const r = robar(G, "ladron1", "victima1");

    expect(r).toMatchObject({ ok: true, exito: true, cantidad: 50 + 10 * 2 }); // 50 base + 10 nivel * 2
    expect(dinero.cuenta("victima1").efectivo).toBe(dinero.INICIAL + 1000 - 70);
    expect(dinero.negro("ladron1")).toBe(70);
    expect(dinero.cuenta("ladron1").efectivo).toBe(dinero.INICIAL); // el efectivo normal del ladrón no cambia

    expect(db.prepare("SELECT cantidad, tipo FROM historial WHERE userId = 'victima1'").get()).toMatchObject({
        cantidad: -70,
        tipo: "robo",
    });
    expect(db.prepare("SELECT cantidad, tipo FROM historial WHERE userId = 'ladron1'").get()).toMatchObject({
        cantidad: 70,
        tipo: "robo",
    });
});

test("lo robado nunca pasa del efectivo que tiene la víctima", () => {
    // Nivel 5 para que la cantidad "en bruto" (hasta 150 base + 10 de bonus = 160) pueda superar
    // lo que le queda a la víctima (150, el mínimo exacto para poder robarle).
    db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 5, 0)").run(G, "ladron2");
    dinero.pagar("victima2", 1000);
    dinero.cobrar("victima2", dinero.efectivo("victima2") - 150);
    jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99); // éxito; cantidad en bruto = 150 + 10 = 160

    const r = robar(G, "ladron2", "victima2");

    expect(r.ok).toBe(true);
    expect(r.exito).toBe(true);
    expect(r.cantidad).toBe(150); // tope: no puede robar más de lo que la víctima tiene
    expect(dinero.efectivo("victima2")).toBe(0);
});

test("si sale mal, paga una multa de su propio efectivo y la víctima no pierde nada", () => {
    dinero.pagar("victima3", 1000);
    jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // falla (>= PROB_EXITO); multa = MULTA_MIN

    const r = robar(G, "ladron3", "victima3");

    expect(r).toMatchObject({ ok: true, exito: false, multa: 30 });
    expect(dinero.cuenta("ladron3").efectivo).toBe(dinero.INICIAL - 30);
    expect(dinero.efectivo("victima3")).toBe(dinero.INICIAL + 1000); // intacta
    expect(dinero.negro("victima3")).toBe(0);
    expect(db.prepare("SELECT cantidad, tipo FROM historial WHERE userId = 'ladron3'").get()).toMatchObject({
        cantidad: -30,
        tipo: "robo",
    });
});

test("la multa nunca deja al ladrón en negativo si tiene menos de lo que le toca pagar", () => {
    dinero.pagar("victima4", 1000);
    dinero.cobrar("ladron4", dinero.INICIAL - 10); // le deja con 10 de efectivo
    jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0.99); // falla; multa = MULTA_MAX (80)

    const r = robar(G, "ladron4", "victima4");

    expect(r.multa).toBe(10); // tope: no puede pagar más de lo que tiene
    expect(dinero.efectivo("ladron4")).toBe(0);
});

test("la víctima necesita un mínimo de efectivo para que merezca la pena robarle, y no consume cooldown", () => {
    dinero.pagar("victimapobre", 100 - dinero.INICIAL); // deja a la víctima con 100 de efectivo (< 150)

    const r1 = robar(G, "ladron5", "victimapobre");
    expect(r1).toEqual({ ok: false, reason: "victima-pobre" });

    // Como no se gastó el intento, puede robar a otra persona sin esperar el cooldown.
    dinero.pagar("victimarica", 1000);
    jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
    const r2 = robar(G, "ladron5", "victimarica");
    expect(r2.ok).toBe(true);
});

test("el cooldown de 2h es global: da igual el servidor desde el que se intente otra vez", () => {
    dinero.pagar("victima6", 1000);
    dinero.pagar("victima7", 1000);
    jest.spyOn(Math, "random").mockReturnValue(0.99); // siempre falla, para no depender del nivel

    const primero = robar(G, "ladron6", "victima6");
    expect(primero.ok).toBe(true);

    const segundo = robar("otro-guild", "ladron6", "victima7");
    expect(segundo).toMatchObject({ ok: false, reason: "cooldown" });
    expect(segundo.retrySeconds).toBeGreaterThan(0);
});

test("el cooldown es por ladrón: a otro no le afecta", () => {
    dinero.pagar("victima8", 1000);
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    robar(G, "ladron7", "victima8");

    const otro = robar(G, "ladron8", "victima8");
    expect(otro.ok).toBe(true);
});
