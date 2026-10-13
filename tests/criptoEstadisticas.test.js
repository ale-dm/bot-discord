// #447 y #445: en 📈 Mercado, el resumen del periodo elegido (precios, variación y volumen) y el ranking de quién gana más
// con TTCL. Las cifras salen de las mismas tablas que la gráfica y la 💼 Cartera, y deben coincidir con ellas.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const mercado = require("../src/systems/cripto/mercado");
const { resumenPeriodo, rankingGanancias, gananciaSinVender } = require("../src/systems/cripto/estadisticas");
const panelMercado = require("../src/paneles/cripto/mercado");
const { pantallaCartera } = require("../src/paneles/cripto/cartera");

const G = "guild-cripto-estadisticas";
const DIA = 24 * 3600 * 1000;
const AHORA = Date.parse("2026-10-14T12:00:00Z");
let n = 0;
const persona = (efectivo = 1_000_000) => {
    const id = `est-${++n}`;
    dinero.pagar(id, efectivo);
    return id;
};
const precio = (p, t) => db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(p, t);
const historial = (userId, tipo, cantidad, monedas, t) =>
    db
        .prepare(
            "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp, comision) VALUES (?,?,?,?,?,?,?,0)",
        )
        .run(userId, tipo, "TTCL", cantidad, monedas / cantidad, monedas, t);

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run(); // precio 100
    db.prepare("DELETE FROM cripto_ttcl_precios").run();
    db.prepare("DELETE FROM cripto_historial").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
});

describe("resumen del periodo (#447)", () => {
    test("inicio, fin, máximo, mínimo y variación del periodo, con el precio anterior como inicio", () => {
        precio(90, AHORA - 10 * DIA); // anterior al periodo de 7 días: es el precio de inicio
        precio(120, AHORA - 6 * DIA);
        precio(80, AHORA - 3 * DIA);
        precio(110, AHORA - 1 * DIA);
        const r = resumenPeriodo(7, AHORA);
        expect(r).toMatchObject({ suficientes: true, inicio: 90, fin: 100, max: 120, min: 80 });
        expect(r.variacionPct).toBeCloseTo(((100 - 90) / 90) * 100, 8);
    });

    test("sin precio anterior, el inicio es el primero del periodo; y cada rango mira su propio periodo", () => {
        precio(120, AHORA - 6 * DIA);
        precio(80, AHORA - 3 * DIA);
        precio(70, AHORA - 20 * DIA);
        expect(resumenPeriodo(7, AHORA)).toMatchObject({ inicio: 70, max: 120, min: 70 }); // el de hace 20 días es el anterior
        const treinta = resumenPeriodo(30, AHORA);
        expect(treinta).toMatchObject({ inicio: 70, max: 120, min: 70 });
        const todo = resumenPeriodo(365, AHORA);
        expect(todo.inicio).toBe(70);
        precio(60, AHORA - 100 * DIA);
        expect(resumenPeriodo(30, AHORA).inicio).toBe(60); // ahora hay un precio anterior a los 30 días
        expect(resumenPeriodo(7, AHORA).inicio).toBe(70);
    });

    test("el volumen de compras y ventas coincide con la suma de cripto_historial del periodo", () => {
        const u = persona();
        historial(u, "compra", 10, 1000, AHORA - 2 * DIA);
        historial(u, "compra", 5, 600, AHORA - 1 * DIA);
        historial(u, "venta", 4, 500, AHORA - 1 * DIA);
        historial(u, "compra", 99, 99999, AHORA - 20 * DIA); // fuera de 7 días
        const suma = (tipo, desde) =>
            db
                .prepare(
                    "SELECT COALESCE(SUM(monedas),0) AS m, COALESCE(SUM(cantidad),0) AS c FROM cripto_historial WHERE tipo = ? AND timestamp >= ?",
                )
                .get(tipo, desde);

        const r = resumenPeriodo(7, AHORA);
        expect(r.compras).toEqual({ monedas: suma("compra", AHORA - 7 * DIA).m, ttcl: suma("compra", AHORA - 7 * DIA).c, operaciones: 2 });
        expect(r.compras.monedas).toBe(1600);
        expect(r.ventas).toEqual({ monedas: 500, ttcl: 4, operaciones: 1 });
        expect(resumenPeriodo(30, AHORA).compras.monedas).toBe(1600 + 99999);
    });

    test("con menos de dos puntos de precio dice que no hay datos suficientes, pero el volumen se da igual", () => {
        const u = persona();
        historial(u, "compra", 1, 100, AHORA - DIA);
        const r = resumenPeriodo(7, AHORA);
        expect(r.suficientes).toBe(false);
        expect(r.inicio).toBeUndefined();
        const texto = panelMercado.textoResumen(r);
        expect(texto).toContain("Sin datos suficientes para este periodo.");
        expect(texto).toContain("Compras: **100 monedas");
        expect(texto).not.toMatch(/undefined|NaN/);
    });

    test("el bloque se pinta en el Mercado con el periodo de los botones de rango", async () => {
        precio(100, Date.now() - 2 * DIA);
        precio(125, Date.now() - 1 * DIA);
        const campos = async (dias) => (await panelMercado.pantallaMercado(G, dias)).embeds[0].toJSON().fields;
        const siete = (await campos(7)).find((f) => f.name.startsWith("📊 Resumen"));
        expect(siete.name).toBe("📊 Resumen · 7 días");
        expect(siete.value).toMatch(/Inicio \*\*100[,.]00\*\* → fin \*\*100[,.]00\*\* · \*\*\+?0,00 %\*\*/);
        expect((await campos(1)).find((f) => f.name.startsWith("📊 Resumen")).name).toBe("📊 Resumen · 24 h");
        expect((await campos(365)).find((f) => f.name.startsWith("📊 Resumen")).name).toBe("📊 Resumen · Todo");
    });

    test("la variación se muestra con signo y coma decimal", () => {
        const r = { suficientes: true, inicio: 100, fin: 90, max: 110, min: 85, variacionPct: -10, compras: vacio(), ventas: vacio() };
        expect(panelMercado.textoResumen(r)).toContain("**−10,00 %**");
        expect(panelMercado.textoResumen({ ...r, fin: 120, variacionPct: 20 })).toContain("**+20,00 %**");
    });
});

function vacio() {
    return { monedas: 0, ttcl: 0, operaciones: 0 };
}

describe("ranking de ganancias (#445)", () => {
    async function escenario() {
        const ganador = persona();
        const perdedor = persona();
        const sinOperar = persona();
        const grande = persona();
        await mercado.ejecutarCompra(G, ganador, "TTCL", 10000);
        await mercado.ejecutarCompra(G, grande, "TTCL", 200000); // sube el precio: el que ya tenía gana sin vender
        await mercado.ejecutarCompra(G, perdedor, "TTCL", 20000);
        await mercado.ejecutarVenta(G, perdedor, "TTCL", 100); // compra cara y vende todo: pierde con comisiones y deslizamiento
        return { ganador, perdedor, sinOperar, grande };
    }

    test("incluye solo a quien ha operado, ordenado por ganancia total (realizada + sin vender), con pérdidas en negativo", async () => {
        const { ganador, perdedor, sinOperar, grande } = await escenario();
        const r = rankingGanancias(5);
        expect(r.map((x) => x.userId)).not.toContain(sinOperar);
        expect(r.map((x) => x.userId).sort()).toEqual([ganador, perdedor, grande].sort());
        expect(r.find((x) => x.userId === ganador).total).toBeGreaterThan(0);
        expect(r.find((x) => x.userId === perdedor).total).toBeLessThan(0);
        expect(r.map((x) => x.total)).toEqual([...r.map((x) => x.total)].sort((a, b) => b - a));
        expect(r.at(-1).userId).toBe(perdedor);
    });

    test("las cifras son las de la 💼 Cartera: la misma ganancia realizada y la misma sin vender", async () => {
        const { ganador, perdedor } = await escenario();
        const r = rankingGanancias(5);
        for (const id of [ganador, perdedor]) {
            const fila = r.find((x) => x.userId === id);
            expect(fila.realizada).toBe(mercado.gananciaRealizadaTtcl(id));
            expect(fila.sinVender).toBe(Math.round(gananciaSinVender(id).ganancia));
            expect(fila.total).toBe(fila.realizada + fila.sinVender);
        }
        const cartera = (await pantallaCartera(ganador)).embeds[0].toJSON().description;
        const sin = gananciaSinVender(ganador).ganancia;
        expect(cartera).toContain(
            `**Ganancia sin vender:** ${sin >= 0 ? "+" : "−"}${Math.round(Math.abs(sin)).toLocaleString("es")} monedas`,
        );
    });

    test("el top se limita a 5 y sin operaciones el ranking está vacío", async () => {
        expect(rankingGanancias(5)).toEqual([]);
        expect(panelMercado.textoRankingGanancias([])).toBe("Nadie ha operado con TTCL todavía.");
        for (let i = 0; i < 7; i++) await mercado.ejecutarCompra(G, persona(), "TTCL", 1000 + i * 100);
        expect(rankingGanancias(5)).toHaveLength(5);
    });

    test("el Mercado lo enseña con signo, y las pérdidas en negativo", async () => {
        const { ganador, perdedor } = await escenario();
        const campo = (await panelMercado.pantallaMercado(G, 7)).embeds[0].toJSON().fields.find((f) => f.name === "🏆 Quién gana más");
        expect(campo.value).toContain(`<@${ganador}> · +`);
        expect(campo.value).toContain(`<@${perdedor}> · −`);
    });
});
