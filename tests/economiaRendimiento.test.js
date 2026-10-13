// #484 y #487: el panel de economía lee el resumen del casino de una fila (casino_resumen, mantenida por triggers) y
// guarda 30 s la valoración de la cartera cripto, que se invalida al comprar o vender.
jest.mock("../src/systems/cripto/graficos", () => ({ generateLineChart: async () => null, generateDonutChart: async () => null }));

const Database = require("better-sqlite3");
const { performance } = require("node:perf_hooks");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/cripto/mercado");
const economia = require("../src/paneles/economia");
const { procesarGanancia, procesarPerdida, descontarApuesta } = require("../src/systems/casinoTransactions");
const migracion = require("../src/core/migrations/048_casino_resumen");

const G = "g-eco-rend";
let n = 0;
const jugador = () => {
    const id = `eco-rend-${++n}`;
    dinero.pagar(id, 1_000_000);
    return id;
};
const resumen = (u) => db.prepare("SELECT ganado, perdido FROM casino_resumen WHERE userId = ?").get(u);
const sumaCompleta = (u) =>
    db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0) AS ganado,
                    COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0) AS perdido FROM casino WHERE userId = ?`,
        )
        .get(u);

describe("resumen del casino (#484)", () => {
    test("la fila coincide con la suma completa tras ganar, perder, un blackjack a medio jugar y cambios directos", () => {
        const u = jugador();
        procesarGanancia(u, "ruleta", 100, 300, "gana", { n: 1 }); // +200
        procesarPerdida(u, "ruleta", 50, "pierde", { n: 2 }); // −50
        procesarGanancia(u, "tragaperras", 10, 10, "empate", {}); // 0
        // Un blackjack a medio jugar: la apuesta ya se descontó, pero la jugada no se registra hasta acabar.
        expect(descontarApuesta(u, 500).exito).toBe(true);
        expect(resumen(u)).toEqual(sumaCompleta(u));
        expect(resumen(u)).toEqual({ ganado: 200, perdido: 50 });
        // Al acabar, la partida entra en el resumen.
        procesarPerdida(u, "blackjack", 500, "pierde blackjack", {});
        expect(resumen(u)).toEqual({ ganado: 200, perdido: 550 });
        expect(resumen(u)).toEqual(sumaCompleta(u));

        // Cambios directos en la tabla (un script, un arreglo a mano): el resumen también los sigue.
        db.prepare("UPDATE casino SET resultado = 1000 WHERE userId = ? AND juego = 'blackjack'").run(u);
        expect(resumen(u)).toEqual(sumaCompleta(u));
        db.prepare("DELETE FROM casino WHERE userId = ? AND juego = 'ruleta'").run(u);
        expect(resumen(u)).toEqual(sumaCompleta(u));
        expect(resumen(u)).toEqual({ ganado: 1000, perdido: 0 });
    });

    test("el panel lee ese resumen; quien nunca ha jugado ve ceros", () => {
        const u = jugador();
        expect(economia.resumenCasino(u)).toEqual({ ganado: 0, perdido: 0 });
        procesarGanancia(u, "ruleta", 100, 400, "gana", { n: 3 });
        procesarPerdida(u, "ruleta", 40, "pierde", { n: 4 });
        expect(economia.resumenCasino(u)).toEqual({ ganado: 300, perdido: 40 });
    });

    test("la migración rellena el resumen de las jugadas que ya existen y se puede repetir", () => {
        const bd = new Database(":memory:");
        bd.exec(
            "CREATE TABLE casino (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, juego TEXT NOT NULL, fecha TEXT NOT NULL, apuesta INTEGER NOT NULL, resultado INTEGER NOT NULL, detalle TEXT)",
        );
        const poner = bd.prepare("INSERT INTO casino (userId, juego, fecha, apuesta, resultado) VALUES (?, 'ruleta', 'f', 10, ?)");
        for (const [u, r] of [
            ["a", 100],
            ["a", -30],
            ["a", 0],
            ["b", -5],
        ])
            poner.run(u, r);

        migracion.up(bd);
        const leer = () => bd.prepare("SELECT userId, ganado, perdido FROM casino_resumen ORDER BY userId").all();
        const esperado = [
            { userId: "a", ganado: 100, perdido: 30 },
            { userId: "b", ganado: 0, perdido: 5 },
        ];
        expect(leer()).toEqual(esperado);
        migracion.up(bd); // otra vez: los mismos números, no el doble
        expect(leer()).toEqual(esperado);
        poner.run("a", 7); // y los triggers siguen funcionando después de repetirla
        expect(leer()[0]).toEqual({ userId: "a", ganado: 107, perdido: 30 });
    });

    test("con 50.000 jugadas, leer el resumen cuesta menos de 0,1 ms", () => {
        const u = jugador();
        const poner = db.prepare(
            "INSERT INTO casino (userId, juego, fecha, apuesta, resultado, detalle) VALUES (?, 'ruleta', 'f', 10, ?, '{}')",
        );
        db.transaction(() => {
            for (let i = 0; i < 50_000; i++) poner.run(u, i % 2 ? 10 : -10);
        })();
        expect(economia.resumenCasino(u)).toEqual({ ganado: 250_000, perdido: 250_000 });
        const veces = 1000;
        const t0 = performance.now();
        for (let i = 0; i < veces; i++) economia.resumenCasino(u);
        expect((performance.now() - t0) / veces).toBeLessThan(0.1);
    });
});

describe("valoración de la cartera en caché (#487)", () => {
    const ahora = new Date("2026-10-13T12:00:00Z").getTime();
    const pintar = (u) => economia.buildEconomia({ viewerId: u, nombre: "x", guildId: G });
    let valorar;

    beforeEach(() => {
        jest.useFakeTimers({ now: ahora, doNotFake: ["setImmediate", "nextTick"] });
        valorar = jest.spyOn(mercado, "valorarCartera");
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test("dentro de 30 s no se vuelve a valorar; pasado ese tiempo, sí", async () => {
        const u = jugador();
        await pintar(u);
        await pintar(u);
        await pintar(u);
        expect(valorar).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(29_000);
        await pintar(u);
        expect(valorar).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1_500);
        await pintar(u);
        expect(valorar).toHaveBeenCalledTimes(2);
    });

    test("un clic de paginación de movimientos no valora la cartera", async () => {
        const u = jugador();
        await pintar(u);
        valorar.mockClear();
        economia.buildMovimientos(u, u, "todo", 0);
        economia.buildMovimientos(u, u, "todo", 1);
        expect(valorar).not.toHaveBeenCalled();
    });

    test("tras comprar o vender, el panel muestra la valoración nueva", async () => {
        const u = jugador();
        const texto = async () => JSON.stringify((await pintar(u)).embeds[0].toJSON());
        expect(await texto()).not.toContain("Cartera cripto");

        const compra = await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        expect(compra.ok).toBe(true);
        const conTtcl = await texto();
        expect(conTtcl).toContain("Cartera cripto");

        // Sin nada que lo invalide, dentro de los 30 s se sigue viendo lo guardado.
        db.prepare("UPDATE cripto_carteras SET cantidad = cantidad * 2 WHERE userId = ? AND cripto = 'TTCL'").run(u);
        expect(await texto()).toBe(conTtcl);
        // Al vender, se recalcula.
        const venta = await mercado.ejecutarVenta(G, u, "TTCL", 100);
        expect(venta.ok).toBe(true);
        expect(await texto()).not.toContain("Cartera cripto");
    });

    test("si el mercado falla no se guarda el fallo: el siguiente clic lo vuelve a intentar", async () => {
        const u = jugador();
        valorar.mockRejectedValueOnce(new Error("sin precios"));
        const sinValorar = await pintar(u);
        expect(sinValorar.embeds[0].toJSON().fields.some((f) => f.name.includes("Cartera"))).toBe(false);
        await pintar(u);
        expect(valorar).toHaveBeenCalledTimes(2);
    });
});
