// 🏇 Carreras con cuotas (#535): cuotas con margen a partir de los pesos, el ganador ponderado decidido en el servidor,
// apostar (una por carrera, límites, autoexclusión, dinero negro primero, fuera de plazo), resolver pagando una sola vez,
// carrera sin apuestas, el cron (abrir, avisar, correr animando o sin animar si pilló el bot apagado), los fotogramas y el
// mensaje con sus botones.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const guildSettings = require("../src/systems/guildSettings");
const autoexclusion = require("../src/systems/casinoAutoexclusion");
const carreras = require("../src/systems/carreras");
const envios = require("../src/discord/envios/carreras");
const carrerasCmd = require("../src/commands/juegos/carreras");
const { mensajeCarrera, fotogramas, META } = require("../src/paneles/carrera");

const G = "g-carreras";
// 12:05 UTC: la siguiente salida es a las 12:15.
const AHORA = Date.UTC(2026, 9, 28, 12, 5);
const SALIDA = Date.UTC(2026, 9, 28, 12, 15);
const fijo = (v) => () => v;

const efectivo = (u) => dinero.cuenta(u).efectivo;
const abrir = (ahora = AHORA) => carreras.asegurarAbierta(G, "c-car", { azar: fijo(0.99), ahora }).carrera;
const impuestoDe = (premio) => impuestos.calcularImpuesto(G, "casino", premio)?.impuesto || 0;

beforeEach(() => {
    db.prepare("DELETE FROM carrera_apuestas").run();
    db.prepare("DELETE FROM carreras").run();
    db.prepare("DELETE FROM banco WHERE userId LIKE 'car-%'").run();
    db.prepare("DELETE FROM historial WHERE userId LIKE 'car-%'").run();
    db.prepare("DELETE FROM casino_autoexclusion WHERE userId LIKE 'car-%'").run();
    db.prepare("DELETE FROM guild_settings WHERE guildId = ?").run(G);
    guildSettings.invalidarAjustes(G);
});

describe("cuotas y ganador", () => {
    test("la cuota sale de la probabilidad con un 10 % de margen, nunca por debajo de 1,10", () => {
        expect(carreras.cuotaDe(0.3)).toBe(3);
        expect(carreras.cuotaDe(0.08)).toBe(11.25);
        expect(carreras.cuotaDe(0.95)).toBe(1.1);
        const lista = carreras.corredores(fijo(0.5));
        expect(lista).toHaveLength(6);
        expect(lista.map((c) => c.peso).sort((a, b) => a - b)).toEqual([...carreras.PESOS].sort((a, b) => a - b));
        const margen = lista.reduce((s, c) => s + 1 / c.cuota, 0);
        expect(margen).toBeGreaterThan(1.1);
    });

    test("el ganador sale con los pesos: el azar recorre los caballos en orden", () => {
        const lista = [{ peso: 50 }, { peso: 30 }, { peso: 20 }];
        expect(carreras.sortearGanador(lista, fijo(0))).toBe(0);
        expect(carreras.sortearGanador(lista, fijo(0.6))).toBe(1);
        expect(carreras.sortearGanador(lista, fijo(0.99))).toBe(2);
    });

    test("la carrera sale en el siguiente cuarto de hora, o en el otro si quedan menos de 3 minutos", () => {
        expect(abrir().empieza).toBe(SALIDA);
        db.prepare("DELETE FROM carreras").run();
        expect(abrir(SALIDA - 2 * 60 * 1000).empieza).toBe(SALIDA + carreras.INTERVALO_MS);
        expect(carreras.asegurarAbierta(G, "c-car", { ahora: AHORA }).nueva).toBe(false);
    });
});

describe("apostar", () => {
    test("una apuesta por persona y carrera, con mínimo y tope, cobrando primero el dinero negro", () => {
        const c = abrir();
        dinero.pagarNegro("car-ana", 30);
        expect(carreras.apostar(c.id, "car-ana", 0, 5, AHORA).motivo).toMatch(/de 10 a 1000/);
        expect(carreras.apostar(c.id, "car-ana", 7, 50, AHORA).motivo).toMatch(/no corre/);
        expect(carreras.apostar(c.id, "car-ana", 0, 50, AHORA).ok).toBe(true);
        expect(dinero.cuenta("car-ana")).toMatchObject({ negro: 0, efectivo: 980 });
        expect(carreras.apostar(c.id, "car-ana", 1, 50, AHORA).motivo).toMatch(/una apuesta por persona/);
        guildSettings.setSetting(G, "carreras.max_apuesta", 20);
        expect(carreras.apostar(c.id, "car-luis", 1, 50, AHORA).motivo).toMatch(/de 10 a 20/);
    });

    test("no se apuesta con la carrera cerrada ni con la autoexclusión del casino", () => {
        const c = abrir();
        expect(carreras.apostar(c.id, "car-ana", 0, 50, SALIDA).motivo).toMatch(/cerradas/);
        autoexclusion.activar("car-luis", Object.keys(autoexclusion.PERIODOS)[0], AHORA);
        expect(carreras.apostar(c.id, "car-luis", 0, 50, AHORA).ok).toBe(false);
        expect(efectivo("car-luis")).toBe(1000);
    });
});

describe("resolver", () => {
    test("paga lo apostado por la cuota a quien acierta, una sola vez", () => {
        const c = abrir();
        carreras.apostar(c.id, "car-ana", 0, 100, AHORA);
        carreras.apostar(c.id, "car-luis", 1, 100, AHORA);
        expect(carreras.resolver(c.id, { azar: fijo(0), ahora: SALIDA - 1 })).toBeNull();
        const r = carreras.resolver(c.id, { azar: fijo(0), ahora: SALIDA });
        const premio = Math.floor(100 * c.corredores[0].cuota);
        expect(r).toMatchObject({ ganadores: [{ userId: "car-ana", premio }], apostado: 200 });
        expect(efectivo("car-ana")).toBe(900 + premio - impuestoDe(premio));
        expect(efectivo("car-luis")).toBe(900);
        expect(carreras.resolver(c.id, { azar: fijo(0), ahora: SALIDA })).toBeNull();
        expect(efectivo("car-ana")).toBe(900 + premio - impuestoDe(premio));
    });

    test("una carrera sin apuestas se resuelve igual y no paga nada", () => {
        const c = abrir();
        expect(carreras.resolver(c.id, { azar: fijo(0.5), ahora: SALIDA })).toMatchObject({ ganadores: [], apostado: 0 });
    });
});

describe("Discord", () => {
    function cliente() {
        const canal = { send: jest.fn(async () => ({ id: "m-car" })), messages: { edit: jest.fn(async () => {}) } };
        return { canal, client: { guilds: { cache: new Map([[G, {}]]) }, channels: { fetch: jest.fn(async () => canal) } } };
    }

    test("sin canal no hay carreras; con canal se abre y se publica la siguiente", async () => {
        const { canal, client } = cliente();
        await envios.revisar(client, AHORA);
        expect(carreras.abierta(G)).toBeNull();
        guildSettings.setSetting(G, "carreras.canal", "c-car");
        await envios.revisar(client, AHORA);
        expect(carreras.abierta(G)).toMatchObject({ messageId: "m-car", empieza: SALIDA });
        expect(canal.send.mock.calls[0][0].components).toHaveLength(2);
    });

    test("avisa 2 minutos antes una vez y, a la hora, anima la carrera con 5 fotogramas y anuncia el ganador", async () => {
        guildSettings.setSetting(G, "carreras.canal", "c-car");
        const { canal, client } = cliente();
        await envios.revisar(client, AHORA);
        await envios.revisar(client, SALIDA - 90 * 1000);
        await envios.revisar(client, SALIDA - 60 * 1000);
        expect(canal.send.mock.calls.filter(([p]) => /sale en 2 minutos/.test(p.content))).toHaveLength(1);
        await envios.revisar(client, SALIDA, { azar: fijo(0.1), pausaMs: 0 });
        expect(canal.messages.edit).toHaveBeenCalledTimes(6);
        expect(canal.send.mock.calls.some(([p]) => /Carrera #\d+\*\*: gana/.test(p.content))).toBe(true);
    });

    test("una carrera que pilló el bot apagado se resuelve sin animación al volver", async () => {
        guildSettings.setSetting(G, "carreras.canal", "c-car");
        const { canal, client } = cliente();
        await envios.revisar(client, AHORA);
        await envios.revisar(client, SALIDA + 30 * 60 * 1000, { pausaMs: 0 });
        expect(canal.messages.edit).toHaveBeenCalledTimes(1);
    });

    test("en los fotogramas solo el ganador llega a la meta, al final", () => {
        const f = fotogramas(3, 6, fijo(0.99));
        expect(f).toHaveLength(5);
        expect(f[4][3]).toBe(META);
        expect(f[4].filter((p) => p === META)).toHaveLength(1);
        expect(f.slice(0, 4).every((fila) => fila.every((p) => p < META))).toBe(true);
    });

    test("el mensaje desactiva los botones al resolverse y el formulario hace la apuesta", async () => {
        const c = abrir(Date.now() - 1);
        const i = {
            customId: `carrera_modal_${c.id}_2`,
            user: { id: "car-ana" },
            fields: { getTextInputValue: () => "100" },
            reply: jest.fn(async () => {}),
        };
        await carrerasCmd.handleModal({}, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Apuesta hecha: \*\*100\*\*/);
        carreras.resolver(c.id, { azar: fijo(0), ahora: c.empieza });
        expect(mensajeCarrera(carreras.obtener(c.id)).components).toEqual([]);
    });
});
