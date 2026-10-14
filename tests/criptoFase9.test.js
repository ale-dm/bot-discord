// Fase 9 (cripto y recordatorios): vender por monedas (#365), alertas de precio (#298), stop-loss (#341), compra recurrente (#351) y
// /recordar (#320). La BD es la de setupEnv.js (en memoria); el pool de TTCL se fija en cada test.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const mercado = require("../src/systems/cripto/mercado");
const ordenes = require("../src/systems/cripto/ordenes");
const ventaPorMonedas = require("../src/systems/cripto/ventaPorMonedas");
const mensajes = require("../src/discord/mensajes/criptoOrdenes");
const recordar = require("../src/systems/recordarPersonal");
const panel = require("../src/paneles/cripto/ordenes");
const manejador = require("../src/perfil/criptoOrdenes");
const comandoRecordar = require("../src/commands/general/recordar");

const G = "g-f9";
let n = 0;
const usuario = (efectivo = 1_000_000, ttcl = 0) => {
    const id = `f9-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    if (ttcl) db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', ?)").run(id, ttcl);
    return id;
};
const ttclDe = (id) => db.prepare("SELECT cantidad FROM cripto_carteras WHERE userId = ? AND cripto = 'TTCL'").get(id)?.cantidad ?? 0;
const pool = (monedas, ttcl) => db.prepare("UPDATE cripto_pool SET monedas = ?, ttcl = ? WHERE id = 1").run(monedas, ttcl);

beforeEach(() => {
    pool(1_000_000, 10_000); // precio 100
    guildSettings.setManySettings(G, {
        "cripto.fee_sell_pct": 2,
        "cripto.fee_buy_pct": 1,
        "cripto.cooldown_sell_sec": 0,
        "cripto.cooldown_buy_sec": 0,
        "cripto.min_sell": 1,
        "cripto.max_sell": 10_000_000,
        "cripto.min_buy": 1,
        "cripto.max_buy": 10_000_000,
        "cripto.max_impact_pct": 100,
    });
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("vender por monedas (#365)", () => {
    test("recibes lo pedido (neto) o un poco menos, nunca más; con la comisión de la venta normal", async () => {
        for (const pedido of [1000, 2500, 7777, 123456]) {
            const u = usuario(0, 5000);
            const q = ventaPorMonedas.cotizarPorMonedas(5000, pedido, 2);
            expect(q.ok).toBe(true);
            expect(q.cot.neto).toBeLessThanOrEqual(pedido);
            expect(q.cot.neto).toBeGreaterThan(pedido - 5);
            const antes = dinero.efectivo(u);
            const r = await mercado.ejecutarVenta(G, u, "TTCL", 100, { ttcl: q.ttcl });
            expect(r.ok).toBe(true);
            expect(dinero.efectivo(u) - antes).toBe(r.monedas);
            expect(r.monedas).toBe(q.cot.neto);
            expect(r.fee).toBe(q.cot.fee);
            expect(ttclDe(u)).toBeCloseTo(5000 - q.ttcl, 6);
            pool(1_000_000, 10_000);
        }
    });

    test("si lo pedido supera lo que vale la posición no se vende nada, y una cantidad mayor que la cartera se rechaza", async () => {
        const u = usuario(0, 10);
        const q = ventaPorMonedas.cotizarPorMonedas(10, 5000, 2);
        expect(q.ok).toBe(false);
        expect(q.motivo).toMatch(/Tu posición solo da/);
        const r = await mercado.ejecutarVenta(G, u, "TTCL", 100, { ttcl: 11 });
        expect(r.ok).toBe(false);
        expect(ttclDe(u)).toBe(10);
        expect(dinero.efectivo(u)).toBe(0);
        expect(ventaPorMonedas.cotizarPorMonedas(10, 0, 2).ok).toBe(false);
    });

    test("los límites min_sell y max_sell se siguen aplicando", async () => {
        guildSettings.setSetting(G, "cripto.min_sell", 5000);
        const u = usuario(0, 100);
        const q = ventaPorMonedas.cotizarPorMonedas(100, 1000, 2);
        const r = await mercado.ejecutarVenta(G, u, "TTCL", 100, { ttcl: q.ttcl });
        expect(r.ok).toBe(false);
        expect(r.msg).toMatch(/entre/);
        expect(ttclDe(u)).toBe(100);
    });

    test("el formulario y la confirmación de la pantalla de vender", async () => {
        const u = usuario(0, 100);
        const i = (customId, extra = {}) => ({
            customId,
            guildId: G,
            user: { id: u, tag: u },
            message: { interaction: { user: { id: u } } },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            ...extra,
        });
        const abrir = i("criptoord_vender");
        await manejador.handleButton(null, abrir);
        expect(abrir.showModal.mock.calls[0][0].data.custom_id).toBe("criptoord_modal_vender");
        const form = i("criptoord_modal_vender", { fields: { getTextInputValue: () => "2.500" } });
        await manejador.handleModal(null, form);
        const confirma = form.update.mock.calls[0][0];
        expect(confirma.embeds[0].data.description).toMatch(/2500 monedas/);
        const ok = i("criptoord_vender_ok_2500");
        await manejador.handleButton(null, ok);
        expect(ok.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Vendiste/);
        expect(dinero.efectivo(u)).toBeGreaterThan(2400);
        expect(dinero.efectivo(u)).toBeLessThanOrEqual(2500);
    });
});

describe("órdenes de TTCL (#298, #341, #351)", () => {
    const avisador = (resultado = true) => {
        const enviados = [];
        return { enviados, avisar: async (userId, payload) => (enviados.push({ userId, payload }), resultado) };
    };

    test("una alerta salta una sola vez, cuando el precio llega, y se borra", async () => {
        const u = usuario();
        const sube = ordenes.crearAlerta(u, G, 120);
        const baja = ordenes.crearAlerta(u, G, 80);
        expect([sube.orden.sobre, baja.orden.sobre]).toEqual([1, 0]);
        const a = avisador();
        expect((await ordenes.revisar(a.avisar, mensajes)).alertas).toBe(0);
        pool(1_300_000, 10_000); // precio 130
        expect((await ordenes.revisar(a.avisar, mensajes)).alertas).toBe(1);
        expect(a.enviados).toHaveLength(1);
        expect(a.enviados[0].payload.embeds[0].data.title).toMatch(/Alerta/);
        expect((await ordenes.revisar(a.avisar, mensajes)).alertas).toBe(0); // no se repite mientras sigue más allá
        expect(ordenes.activasDe(u).map((o) => o.id)).toEqual([baja.orden.id]);
    });

    test("si el DM no llega la alerta se mantiene", async () => {
        const u = usuario();
        ordenes.crearAlerta(u, G, 150);
        pool(2_000_000, 10_000);
        const a = avisador(false);
        expect((await ordenes.revisar(a.avisar, mensajes)).alertas).toBe(0);
        expect(ordenes.activasDe(u)).toHaveLength(1);
        const b = avisador(true);
        expect((await ordenes.revisar(b.avisar, mensajes)).alertas).toBe(1);
        expect(ordenes.activasDe(u)).toHaveLength(0);
    });

    test("validaciones y límite de órdenes por tipo; cancelar es de quien la creó", () => {
        const u = usuario();
        expect(ordenes.crearAlerta(u, G, 100).ok).toBe(false); // el precio de ahora
        expect(ordenes.crearAlerta(u, G, -5).ok).toBe(false);
        expect(ordenes.crearStopLoss(u, G, 150).ok).toBe(false); // por encima del actual
        expect(ordenes.crearRecurrente(u, G, 0, 24).ok).toBe(false);
        expect(ordenes.crearRecurrente(u, G, 1000, 0).ok).toBe(false);
        for (let i = 0; i < ordenes.MAX_POR_TIPO; i++) expect(ordenes.crearAlerta(u, G, 110 + i).ok).toBe(true);
        expect(ordenes.crearAlerta(u, G, 200).mensaje).toMatch(/Cancela/);
        const [primera] = ordenes.activasDe(u);
        expect(ordenes.cancelar("otro", primera.id)).toBe(false);
        expect(ordenes.cancelar(u, primera.id)).toBe(true);
        expect(ordenes.cancelar(u, primera.id)).toBe(false);
        expect(ordenes.crearAlerta(u, G, 200).ok).toBe(true);
    });

    test("stop-loss: al cruzar el umbral vende toda la posición una sola vez, con la comisión de siempre, y avisa", async () => {
        const u = usuario(0, 50);
        ordenes.crearStopLoss(u, G, 90);
        const a = avisador();
        expect((await ordenes.revisar(a.avisar, mensajes)).stoploss).toBe(0);
        pool(800_000, 10_000); // precio 80
        const antes = dinero.efectivo(u);
        expect((await ordenes.revisar(a.avisar, mensajes)).stoploss).toBe(1);
        expect(ttclDe(u)).toBe(0);
        expect(dinero.efectivo(u)).toBeGreaterThan(antes);
        const mios = () => a.enviados.filter((e) => e.userId === u);
        expect(mios()[0].payload.embeds[0].data.title).toMatch(/ejecutado/);
        expect(db.prepare("SELECT estado FROM cripto_ordenes WHERE userId = ?").get(u).estado).toBe("ejecutada");
        const vez2 = await ordenes.revisar(a.avisar, mensajes);
        expect(vez2.stoploss).toBe(0);
        expect(mios()).toHaveLength(1);
    });

    test("stop-loss sin TTCL se cancela; con cooldown se reintenta y no vende más de lo que hay", async () => {
        const sin = usuario(0, 0);
        ordenes.crearStopLoss(sin, G, 90);
        const con = usuario(0, 10);
        ordenes.crearStopLoss(con, G, 90);
        guildSettings.setSetting(G, "cripto.cooldown_sell_sec", 600);
        guildSettings.checkAndConsumeLimit(G, "cripto_sell", con, { cooldownSec: 600 }); // acaba de vender
        pool(800_000, 10_000);
        const a = avisador();
        await ordenes.revisar(a.avisar, mensajes);
        expect(db.prepare("SELECT estado FROM cripto_ordenes WHERE userId = ?").get(sin).estado).toBe("cancelada");
        expect(db.prepare("SELECT estado FROM cripto_ordenes WHERE userId = ?").get(con).estado).toBe("activa");
        expect(ttclDe(con)).toBe(10);
        guildSettings.setSetting(G, "cripto.cooldown_sell_sec", 0);
    });

    test("compra recurrente: compra con las reglas de una compra, deja historial y adelanta la fecha", async () => {
        const u = usuario(50_000);
        const t0 = Date.now();
        const r = ordenes.crearRecurrente(u, G, 5000, 2, t0);
        expect(r.orden.proxima).toBe(t0 + 2 * 3600000);
        const a = avisador();
        expect((await ordenes.revisar(a.avisar, mensajes, t0 + 3600000)).compras).toBe(0); // aún no toca
        const resultado = await ordenes.revisar(a.avisar, mensajes, t0 + 2 * 3600000 + 1000);
        expect(resultado.compras).toBe(1);
        expect(ttclDe(u)).toBeGreaterThan(0);
        expect(dinero.efectivo(u)).toBeLessThan(50_000 - 5000 + 1);
        expect(db.prepare("SELECT tipo FROM cripto_historial WHERE userId = ?").get(u).tipo).toBe("compra");
        expect(db.prepare("SELECT proxima FROM cripto_ordenes WHERE userId = ?").get(u).proxima).toBe(
            t0 + 2 * 3600000 + 1000 + 2 * 3600000,
        );
        expect(a.enviados).toHaveLength(0);
    });

    test("sin efectivo salta el ciclo, avisa con la fecha del siguiente intento y no deja saldo negativo ni toca el banco", async () => {
        const u = usuario(100);
        db.prepare("UPDATE banco SET saldo = 999999 WHERE userId = ?").run(u);
        const t0 = Date.now();
        ordenes.crearRecurrente(u, G, 5000, 1, t0);
        const a = avisador();
        const ahora = t0 + 3600000 + 5;
        expect((await ordenes.revisar(a.avisar, mensajes, ahora)).compras).toBe(0);
        expect(dinero.cuenta(u)).toMatchObject({ efectivo: 100, banco: 999999 });
        expect(a.enviados[0].payload.embeds[0].data.description).toMatch(new RegExp(`<t:${Math.floor((ahora + 3600000) / 1000)}:f>`));
        expect((await ordenes.revisar(a.avisar, mensajes, ahora + 10)).compras).toBe(0); // ya está adelantada: no avisa otra vez
        expect(a.enviados).toHaveLength(1);
    });

    test("la pantalla de órdenes y sus formularios", async () => {
        const u = usuario(100000, 20);
        const i = (customId, extra = {}) => ({
            customId,
            guildId: G,
            user: { id: u, tag: u },
            message: { interaction: { user: { id: u } } },
            update: jest.fn(async () => {}),
            reply: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            values: [],
            ...extra,
        });
        const campos = (obj) => ({ fields: { getTextInputValue: (id) => obj[id] } });
        const alerta = i("criptoord_modal_alerta", campos({ precio: "150" }));
        await manejador.handleModal(null, alerta);
        expect(alerta.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Alerta|alerta/);
        const stop = i("criptoord_modal_stoploss", campos({ precio: "70" }));
        await manejador.handleModal(null, stop);
        const rec = i("criptoord_modal_recurrente", campos({ monedas: "2000", horas: "12" }));
        await manejador.handleModal(null, rec);
        expect(rec.update.mock.calls[0][0].embeds[0].data.description).toMatch(/cada \*\*12 h\*\*/);
        const ok = i("criptoord_rec_ok_2000_12");
        await manejador.handleButton(null, ok);
        const lista = panel.pantallaOrdenes(u).embeds[0].data.description;
        expect(lista).toMatch(/Alerta/);
        expect(lista).toMatch(/Stop-loss/);
        expect(lista).toMatch(/Compra recurrente/);
        const [primera] = ordenes.activasDe(u);
        const cancelar = i("criptoord_cancelar", { values: [String(primera.id)] });
        await manejador.handleSelect(null, cancelar);
        expect(ordenes.activasDe(u)).toHaveLength(2);
        const mal = i("criptoord_modal_recurrente", campos({ monedas: "abc", horas: "0" }));
        await manejador.handleModal(null, mal);
        expect(mal.update.mock.calls[0][0].embeds[0].data.description).toMatch(/Escribe monedas enteras/);
    });
});

describe("/recordar (#320)", () => {
    // El 14 de octubre de 2026 a las 10:00 en Madrid (08:00 UTC).
    const AHORA = Date.UTC(2026, 9, 14, 8, 0);
    const iso = (ms) => new Date(ms).toISOString();

    test("la hora: HH:MM de hoy o de mañana, «mañana HH:MM», «en N min/h» hasta 24 h", () => {
        const c = (t) => recordar.parsearCuando(t, AHORA);
        expect(iso(c("18:30").cuando)).toBe("2026-10-14T16:30:00.000Z");
        expect(iso(c("09:00").cuando)).toBe("2026-10-15T07:00:00.000Z"); // ya pasó hoy: mañana
        expect(iso(c("mañana 09:00").cuando)).toBe("2026-10-15T07:00:00.000Z");
        expect(iso(c("hoy 20:15").cuando)).toBe("2026-10-14T18:15:00.000Z");
        expect(c("hoy 07:00").ok).toBe(false);
        expect(c("en 45 min").cuando).toBe(AHORA + 45 * 60000);
        expect(c("dentro de 90 minutos").cuando).toBe(AHORA + 90 * 60000);
        expect(c("en 2 h").cuando).toBe(AHORA + 2 * 3600000);
        expect(c("en 25 h").ok).toBe(false);
        expect(c("en 0 min").ok).toBe(false);
        expect(c("25:00").ok).toBe(false);
        expect(c("cuando quieras").ok).toBe(false);
        expect(c("mañana 11:00").ok).toBe(false); // pasa de 24 h
    });

    test("crear: texto y límites; lista y borrado propios", () => {
        const u = `rec-${++n}`;
        expect(recordar.crear(u, "en 5 min", "").ok).toBe(false);
        expect(recordar.crear(u, "en 5 min", "x".repeat(201)).ok).toBe(false);
        expect(recordar.crear(u, "luego", "algo").ok).toBe(false);
        for (let k = 0; k < recordar.MAX_ACTIVOS; k++) expect(recordar.crear(u, `en ${k + 1} min`, `aviso ${k}`, AHORA).ok).toBe(true);
        expect(recordar.crear(u, "en 30 min", "otro", AHORA).mensaje).toMatch(/Borra/);
        const lista = recordar.pendientes(u);
        expect(lista).toHaveLength(10);
        expect(recordar.borrar("otro", lista[0].id)).toBe(false);
        expect(recordar.borrar(u, lista[0].id)).toBe(true);
        expect(recordar.crear(u, "en 30 min", "otro", AHORA).ok).toBe(true);
    });

    test("el cron manda los vencidos por DM, una sola vez, y si el DM está cerrado se pierde sin reintentar", async () => {
        const [a, b] = [`rec-${++n}`, `rec-${++n}`];
        const t0 = Date.now();
        recordar.crear(a, "en 5 min", "Partido de Jorge", t0);
        recordar.crear(b, "en 5 min", "No llegará", t0);
        recordar.crear(a, "en 60 min", "Más tarde", t0);
        const enviados = [];
        const client = {
            users: {
                fetch: async (id) => {
                    if (id === b) throw Object.assign(new Error("cerrado"), { code: 50007 });
                    return { send: async (p) => enviados.push({ id, p }) };
                },
            },
        };
        expect(await recordar.enviarVencidos(client, t0 + 4 * 60000)).toBe(0);
        expect(await recordar.enviarVencidos(client, t0 + 6 * 60000)).toBe(1);
        expect(enviados[0].p.content).toContain("Partido de Jorge");
        expect(await recordar.enviarVencidos(client, t0 + 7 * 60000)).toBe(0);
        expect(recordar.pendientes(b)).toEqual([]);
        expect(recordar.pendientes(a).map((r) => r.texto)).toEqual(["Más tarde"]);
    });

    test("el comando: nuevo y lista con botón de borrar", async () => {
        const u = `rec-${++n}`;
        const opciones = (sub, valores = {}) => ({ getSubcommand: () => sub, getString: (k) => valores[k] });
        const reply = jest.fn(async () => {});
        await comandoRecordar.run(null, { user: { id: u }, options: opciones("nuevo", { cuando: "en 10 min", texto: "Quiniela" }), reply });
        expect(reply.mock.calls[0][0].content).toMatch(/Te lo recordaré/);
        const lista = jest.fn(async () => {});
        await comandoRecordar.run(null, { user: { id: u }, options: opciones("lista"), reply: lista });
        const [pendiente] = recordar.pendientes(u);
        expect(lista.mock.calls[0][0].content).toContain("Quiniela");
        expect(lista.mock.calls[0][0].components[0].components[0].data.custom_id).toBe(`recordar_borrar_${pendiente.id}`);
        const update = jest.fn(async () => {});
        await comandoRecordar.handleButton(null, { customId: `recordar_borrar_${pendiente.id}`, user: { id: u }, update });
        expect(update.mock.calls[0][0].content).toMatch(/Borrado/);
        expect(recordar.pendientes(u)).toEqual([]);
    });
});
