// Casino: los últimos números de la ruleta (#458) y el historial de jackpots de la tragaperras (#456). Salen de la tabla
// del casino, sin migración nueva.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const ruleta = require("../src/systems/casino/ruleta");
const tragaperras = require("../src/systems/casino/tragaperras");
const { procesarGanancia } = require("../src/systems/casinoTransactions");
const casino = require("../src/paneles/casino");

let n = 0;
function jugador() {
    const id = `ultimos-${++n}`;
    dinero.pagar(id, 100000);
    return id;
}
const descripcion = (pantalla) => pantalla.embeds[0].toJSON().description;

beforeEach(() => db.prepare("DELETE FROM casino").run());

describe("últimos números de la ruleta (#458)", () => {
    test("sin tiradas, el panel dice que aún no hay", () => {
        expect(ruleta.ultimosNumeros()).toEqual([]);
        expect(descripcion(casino.buildPickRuleta(jugador()))).toContain("aún no hay tiradas");
    });

    test("muestra los últimos 10 con su color, del más reciente al más antiguo, de todos los jugadores", () => {
        const a = jugador();
        const b = jugador();
        // 12 tiradas con el número fijado: 1 (rojo), 2 (negro), 3 (rojo), … y un 0 al final.
        for (let i = 1; i <= 11; i++) ruleta.liquidarTirada(i % 2 ? a : b, "g", { apuesta: 10, tipo: "color", valor: "rojo", numero: i });
        ruleta.liquidarTirada(a, "g", { apuesta: 10, tipo: "color", valor: "rojo", numero: 0 });

        const ultimos = ruleta.ultimosNumeros();
        expect(ultimos).toHaveLength(10);
        expect(ultimos[0]).toEqual({ n: 0, color: "verde" });
        expect(ultimos[1]).toEqual({ n: 11, color: "negro" });
        expect(ultimos[2]).toEqual({ n: 10, color: "negro" });
        expect(ultimos[9].n).toBe(3);

        const linea = descripcion(casino.buildPickRuleta(a));
        expect(linea).toContain("🟢 0 · ⚫ 11 · ⚫ 10 · 🔴 9");
        expect(linea).not.toContain("🔴 1 ·");
    });

    test("las partidas de otros juegos no cuentan", () => {
        const a = jugador();
        procesarGanancia(a, "tragaperras", 10, 20, "x", { tipo: "doble" });
        expect(ruleta.ultimosNumeros()).toEqual([]);
    });
});

describe("historial de jackpots (#456)", () => {
    const jackpot = (userId, cantidad) =>
        procesarGanancia(userId, "tragaperras", 100, cantidad, "🎰 JACKPOT", {
            tipo: "JACKPOT",
            multiplicador: "JACKPOT",
            jackpot: cantidad,
        });

    test("sin jackpots, la pantalla lo dice y no enseña ningún bote", () => {
        expect(tragaperras.ultimosJackpots()).toEqual([]);
        expect(descripcion(casino.buildJackpots())).toBe("Todavía nadie ha ganado el jackpot.");
    });

    test("lista los últimos 10 con ganador, fecha y cantidad; las victorias normales no cuentan", () => {
        const a = jugador();
        const b = jugador();
        procesarGanancia(a, "tragaperras", 100, 300, "triple", { tipo: "triple" });
        for (let i = 1; i <= 11; i++) jackpot(i % 2 ? a : b, 10000 + i * 1000);

        const lista = tragaperras.ultimosJackpots();
        expect(lista).toHaveLength(10);
        expect(lista[0]).toMatchObject({ userId: a, cantidad: 21000 });
        expect(lista[9].cantidad).toBe(12000);

        const lineas = descripcion(casino.buildJackpots()).split("\n");
        expect(lineas).toHaveLength(10);
        expect(lineas[0]).toMatch(new RegExp(`^<t:\\d+:d> · <@${a}> · \\*\\*21\\.000\\*\\* 🪙$`));
    });

    test("el selector de apuesta de la tragaperras tiene el botón 🏆 Jackpots; el de otros juegos no", () => {
        const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
        expect(ids(casino.buildPickApuesta(jugador(), "tragaperras"))).toContain("casino_jackpots");
        expect(ids(casino.buildPickApuesta(jugador(), "blackjack"))).not.toContain("casino_jackpots");
    });
});
