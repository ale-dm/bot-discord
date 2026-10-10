// Lo que se programa al arrancar (#240): cuántas tareas hay, con qué horario y zona, qué intervalos y cuáles se lanzan
// ya al arrancar. Los trabajos de cada tarea son módulos simulados (cualquier función responde en vacío): no hay
// red, ni Discord, ni base de datos de trabajo, pero sí se ejecuta el código que los llama.
const cron = require("node-cron");

jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../src/core/interactionLog", () => ({ ...jest.requireActual("../src/core/interactionLog"), runJob: jest.fn() }));
// Cualquier función de estos módulos existe y responde en vacío.
const simulado = () => new Proxy({}, { get: (t, p) => (p === "then" ? undefined : (t[p] ??= jest.fn(async () => {}))) });
for (const ruta of [
    "../src/systems/alertas",
    "../src/systems/xpSystem",
    "../src/services/tautulliClient",
    "../src/systems/apuestas/liquidacion",
    "../src/juegos/casino/blackjack.js",
    "../src/juegos/casino/adivinar.js",
    "../src/systems/pedidosSeerr",
    "../src/systems/plexHistorial",
    "../src/systems/plexRankingSemanal",
    "../src/systems/clasificacionSemanal",
    "../src/services/oddsApi",
    "../src/systems/plexWrapped",
    "../src/systems/cine",
    "../src/systems/apuestas/liga",
    "../src/systems/resumenAdmin",
    "../src/systems/duende/espontaneo",
    "../src/systems/apuestas/destacado",
    "../src/systems/apuestas/recordatorios",
    "../src/juegos/retos/retos",
    "../src/juegos/retos/duende",
    "../src/systems/negocios",
    "../src/systems/cripto/eventos",
    "../src/systems/patrimonio",
    "../src/systems/backups",
]) {
    jest.doMock(ruta, simulado);
}

const { runJob } = require("../src/core/interactionLog");
const { programarTareas } = require("../src/core/tareas");

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, "setInterval").mockImplementation(() => 0);
    programarTareas({ user: { setPresence: jest.fn() }, guilds: { cache: new Map() } });
});
afterEach(() => {
    jest.restoreAllMocks();
});

test("al ejecutarse, cada tarea hace su trabajo sin errores", async () => {
    for (const [, fn] of cron.schedule.mock.calls) await fn();
    for (const [, fn] of runJob.mock.calls) await fn();
    expect(runJob.mock.calls.length).toBeGreaterThan(20);
});

const horarios = () => cron.schedule.mock.calls.map(([expr, , opts]) => ({ expr, timezone: opts?.timezone }));

test("se programan 19 tareas de cron, una por cada trabajo del bot", () => {
    expect(cron.schedule).toHaveBeenCalledTimes(19);
});

test("las tareas que dependen de la hora de Madrid llevan esa zona", () => {
    const h = horarios();
    for (const expr of ["0 17 * * *", "0 * * * 1", "0 * * * *", "0 11-23 * * *", "0 10-20 * * *", "15 * * * *", "30 4 * * *"]) {
        const tarea = h.find((x) => x.expr === expr);
        expect(tarea).toBeDefined();
        expect(tarea.timezone).toBe("Europe/Madrid");
    }
});

test("los horarios de cada trabajo están (una muestra de cada área)", () => {
    const exprs = horarios().map((x) => x.expr);
    expect(exprs).toEqual(
        expect.arrayContaining(["*/30 * * * *", "*/10 * * * *", "*/5 * * * *", "0 17 * * *", "15 * * * *", "30 4 * * *"]),
    );
});

test("hay dos intervalos fijos: la actividad cada 90 min y la XP de voz cada minuto", () => {
    const intervalos = global.setInterval.mock.calls.map(([, ms]) => ms);
    expect(intervalos).toEqual(expect.arrayContaining([5400000, 60000]));
});

test("las tareas que se lanzan al arrancar están, con su nombre", () => {
    const nombres = runJob.mock.calls.map(([nombre]) => nombre);
    for (const nombre of [
        "Alertas pendientes del arranque",
        "Ranking semanal de Plex (arranque)",
        "Clasificación semanal (arranque)",
        "Plex Wrapped (arranque)",
        "Liga de pronósticos (arranque)",
        "Resumen semanal para admins (arranque)",
        "Partido destacado del día (arranque)",
    ]) {
        expect(nombres).toContain(nombre);
    }
});
