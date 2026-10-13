// /cripto: comisión en el historial (#441), ganancia realizada (#443), cooldown visible (#455), historial de eventos (#449)
// y pausa del mercado por un admin (#453). Sin Discord ni gráficas (se simulan).
jest.mock("../src/systems/cripto/graficos", () => ({
    generateLineChart: async () => null,
    generateDonutChart: async () => null,
}));

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const mercado = require("../src/systems/cripto/mercado");
const eventos = require("../src/systems/cripto/eventos");
const paneles = require("../src/paneles/cripto");
const { lineaHistorial } = require("../src/paneles/cripto/historial");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { buildCriptoPanel } = require("../src/adminPanel/settings/vistas");

const G = "guild-cripto-mejoras";
let n = 0;
function cliente(efectivo = 2_000_000) {
    const id = `mejoras-${++n}`;
    dinero.pagar(id, efectivo);
    return id;
}
const descripcion = (pantalla) => pantalla.embeds[0].toJSON().description;
const ids = (pantalla) => pantalla.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

beforeEach(() => {
    db.prepare("UPDATE cripto_pool SET monedas = 1000000, ttcl = 10000 WHERE id = 1").run();
    db.prepare("DELETE FROM cripto_carteras WHERE cripto = 'TTCL'").run();
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

describe("comisión en el historial (#441)", () => {
    test("cada compra y venta guarda la comisión que se descontó", async () => {
        const u = cliente();
        const antes = dinero.efectivo(u);
        const compra = await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        expect(compra.fee).toBe(100);
        expect(antes - dinero.efectivo(u)).toBe(10000 + 100);
        const venta = await mercado.ejecutarVenta(G, u, "TTCL", 50);
        expect(venta.ok).toBe(true);
        expect(venta.fee).toBeGreaterThan(0);

        const [v, c] = mercado.historialTtcl(u, 10, 0);
        expect(c.comision).toBe(compra.fee);
        expect(v.comision).toBe(venta.fee);
        expect(lineaHistorial(c)).toMatch(/comisión 100 monedas/);
        expect(lineaHistorial(v)).toContain(`comisión ${venta.fee} monedas`);
    });

    test("una operación anterior a guardar la comisión enseña «—», no un 0", () => {
        const u = cliente();
        db.prepare(
            "INSERT INTO cripto_historial (userId, tipo, cripto, cantidad, precio, monedas, timestamp) VALUES (?, 'compra', 'TTCL', 5, 100, 505, ?)",
        ).run(u, Date.now());
        const [vieja] = mercado.historialTtcl(u, 10, 0);
        expect(vieja.comision).toBeNull();
        expect(lineaHistorial(vieja)).toMatch(/comisión —/);
    });
});

describe("ganancia realizada en la cartera (#443)", () => {
    test("compra y venta parcial: se calcula con el coste medio de lo vendido", async () => {
        const u = cliente();
        const compra = await mercado.ejecutarCompra(G, u, "TTCL", 100000);
        const venta = await mercado.ejecutarVenta(G, u, "TTCL", 50);
        expect(venta.ok).toBe(true);
        // La mitad de las unidades costó la mitad de lo pagado (comisión de compra incluida); se cobra el neto de la venta.
        const esperado = Math.round(venta.monedas - compra.costeTotal / 2);
        expect(mercado.gananciaRealizadaTtcl(u)).toBe(esperado);
        const texto = descripcion(await paneles.pantallaCartera(u));
        expect(texto).toContain(`Ganancia realizada:** ${esperado > 0 ? "+" : "−"}${Math.abs(esperado).toLocaleString("es")} monedas`);
    });

    test("vender todo y bajar el precio da pérdida realizada", async () => {
        const u = cliente();
        await mercado.ejecutarCompra(G, u, "TTCL", 100000);
        db.prepare("UPDATE cripto_pool SET monedas = monedas / 2 WHERE id = 1").run();
        await mercado.ejecutarVenta(G, u, "TTCL", 100);
        expect(mercado.gananciaRealizadaTtcl(u)).toBeLessThan(0);
        expect(descripcion(await paneles.pantallaCartera(u))).toMatch(/Ganancia realizada:\*\* −/);
    });

    test("sin ventas, «Ganancia realizada: 0»", async () => {
        const u = cliente();
        expect(descripcion(await paneles.pantallaCartera(u))).toContain("Ganancia realizada:** 0 monedas");
        await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        expect(mercado.gananciaRealizadaTtcl(u)).toBe(0);
        expect(descripcion(await paneles.pantallaCartera(u))).toContain("Ganancia realizada:** 0 monedas");
    });
});

describe("cooldown visible en Comprar y Vender (#455)", () => {
    test("con cooldown, tras operar las pestañas dicen cuánto falta, sin gastarlo al mirar", async () => {
        const u = cliente();
        guildSettings.setManySettings(G, { "cripto.cooldown_buy_sec": 600, "cripto.cooldown_sell_sec": 120 });
        expect(descripcion(paneles.pantallaComprar(u, G))).not.toMatch(/Podrás/);

        await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        await mercado.ejecutarVenta(G, u, "TTCL", 10);
        expect(descripcion(paneles.pantallaComprar(u, G))).toMatch(/Podrás comprar en (9|10) min/);
        expect(descripcion(paneles.pantallaVender(u, G))).toMatch(/Podrás vender en (1|2) min/);
    });

    test("consultar el tiempo restante no consume el cooldown", () => {
        const u = cliente();
        guildSettings.setManySettings(G, { "cripto.cooldown_buy_sec": 600 });
        for (let i = 0; i < 3; i++) expect(mercado.cooldownRestante(G, u, "compra")).toBe(0);
        const filas = db.prepare("SELECT COUNT(*) AS n FROM action_limits WHERE guildId = ? AND userId = ?").get(G, u).n;
        expect(filas).toBe(0);
    });

    test("sin cooldown configurado, la pantalla no muestra la línea", async () => {
        const u = cliente();
        await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        expect(descripcion(paneles.pantallaComprar(u, G))).not.toMatch(/Podrás/);
        expect(descripcion(paneles.pantallaVender(u, G))).not.toMatch(/Podrás/);
    });
});

describe("historial de eventos de TTCL (#449)", () => {
    const dia = (d) => Date.UTC(2026, 9, d, 12);
    beforeEach(() => db.prepare("DELETE FROM cripto_eventos").run());

    test("sin eventos, la pantalla lo dice", () => {
        expect(descripcion(paneles.pantallaEventos())).toBe("Todavía no ha habido ningún evento.");
    });

    test("muestra los últimos 10, con fecha, dirección, porcentaje y precios; el cron no duplica el del día", () => {
        for (let d = 1; d <= 12; d++) {
            eventos.revisar(dia(d), () => 0);
            eventos.revisar(dia(d) + 60_000, () => 0); // el cron de 5 min vuelve a mirar el mismo día
        }
        expect(db.prepare("SELECT COUNT(*) AS n FROM cripto_eventos").get().n).toBe(12);
        const lista = eventos.ultimosEventos(10);
        expect(lista).toHaveLength(10);
        expect(lista[0].dia).toBe("2026-10-12");
        const lineas = descripcion(paneles.pantallaEventos()).split("\n");
        expect(lineas).toHaveLength(10);
        expect(lineas[0]).toMatch(/📈 Sube un \*\*5 %\*\*.*→/);
    });

    test("el botón 📰 Eventos está en 📈 Mercado", async () => {
        expect(ids(await paneles.pantallaMercado(G))).toContain("cripto_eventos");
    });
});

describe("pausa del mercado por un admin (#453)", () => {
    test("con la pausa, comprar y vender devuelven el mensaje fijo y no tocan saldo, cartera ni precio", async () => {
        const u = cliente();
        await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        guildSettings.setSetting(G, "cripto.pausa", true);
        const efectivo = dinero.efectivo(u);
        const pool = db.prepare("SELECT monedas, ttcl FROM cripto_pool WHERE id = 1").get();
        const tiene = mercado.getUserCarteras(u)[0].cantidad;

        const compra = await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        const venta = await mercado.ejecutarVenta(G, u, "TTCL", 50);
        expect(compra).toEqual({ ok: false, msg: mercado.MENSAJE_PAUSA });
        expect(venta).toEqual({ ok: false, msg: mercado.MENSAJE_PAUSA });
        expect(dinero.efectivo(u)).toBe(efectivo);
        expect(db.prepare("SELECT monedas, ttcl FROM cripto_pool WHERE id = 1").get()).toEqual(pool);
        expect(mercado.getUserCarteras(u)[0].cantidad).toBe(tiene);
    });

    test("las pestañas Comprar y Vender muestran el aviso en lugar del formulario", () => {
        const u = cliente();
        guildSettings.setSetting(G, "cripto.pausa", true);
        for (const pantalla of [paneles.pantallaComprar(u, G), paneles.pantallaVender(u, G)]) {
            expect(descripcion(pantalla)).toBe(mercado.MENSAJE_PAUSA);
            expect(ids(pantalla).filter((i) => i.startsWith("cripto_comprar_") || i.startsWith("cripto_vender_"))).toEqual([]);
        }
    });

    test("la pausa no impide ver el mercado, la cartera, el historial ni aplicar el evento del día", async () => {
        const u = cliente();
        await mercado.ejecutarCompra(G, u, "TTCL", 10000);
        guildSettings.setSetting(G, "cripto.pausa", true);
        const mer = await paneles.pantallaMercado(G);
        expect(mer.embeds[0].toJSON().fields.some((f) => f.name.includes("Mercado en pausa"))).toBe(true);
        expect(descripcion(await paneles.pantallaCartera(u))).toMatch(/Tienes/);
        expect((await paneles.pantallaHistorial(u, 0)).embeds[0].toJSON().description).toMatch(/Compra/);
        db.prepare("DELETE FROM cripto_eventos").run();
        expect(eventos.revisar(Date.UTC(2026, 10, 3, 12), () => 0)).not.toBeNull();
    });

    test("un admin pausa y reanuda desde el panel, y el estado se ve", async () => {
        const interaccion = (v) => ({
            customId: "paneladmin_cfg_cripto_pausa",
            guildId: G,
            user: { id: "admin" },
            update: async (x) => (v.vista = x),
        });
        const v = {};
        expect(JSON.stringify(buildCriptoPanel(G).embeds[0].toJSON())).toContain("Abierto");
        expect(await handleSettingsButton(interaccion(v))).toBe(true);
        expect(mercado.mercadoPausado(G)).toBe(true);
        expect(JSON.stringify(v.vista.embeds[0].toJSON())).toContain("En pausa");
        expect(JSON.stringify(v.vista.components.map((c) => c.toJSON()))).toContain("Reanudar mercado");
        await handleSettingsButton(interaccion(v));
        expect(mercado.mercadoPausado(G)).toBe(false);
    });
});
