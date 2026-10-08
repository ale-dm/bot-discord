// Gráficas de /cripto (F-EC-12f, #122): ECharts + resvg, sin canvas. Devuelven un PNG, o null si no hay datos.
const db = require("../src/core/db");
const graficos = require("../src/systems/cripto/graficos");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ahora = Date.now();

beforeEach(() => {
    db.prepare("DELETE FROM cripto_ttcl_precios").run();
    db.prepare("DELETE FROM cripto_carteras WHERE userId LIKE 'graf-%'").run();
});

test("la gráfica de precio de TTCL devuelve un PNG", async () => {
    for (let i = 0; i < 30; i++) {
        db.prepare("INSERT INTO cripto_ttcl_precios (precio, timestamp) VALUES (?, ?)").run(100 + i, ahora - (30 - i) * 3600e3);
    }
    const buf = await graficos.generateLineChart("TTCL", 7, "$TTCL — 7 días", "#9b59b6");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 8).equals(PNG)).toBe(true);
});

test("la gráfica de precio funciona aunque no haya historial (dibuja el precio actual)", async () => {
    const buf = await graficos.generateLineChart("TTCL", 1, "$TTCL — 24 horas", "#9b59b6");
    expect(buf.subarray(0, 8).equals(PNG)).toBe(true);
});

test("el donut de la cartera devuelve un PNG si hay TTCL", async () => {
    db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES ('graf-1', 'TTCL', 42)").run();
    const buf = await graficos.generateDonutChart("graf-1");
    expect(buf.subarray(0, 8).equals(PNG)).toBe(true);
});

test("el donut no dibuja nada si no hay cartera", async () => {
    expect(await graficos.generateDonutChart("graf-sin-cartera")).toBeNull();
});
